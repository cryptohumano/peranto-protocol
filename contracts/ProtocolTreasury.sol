// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PaymentLib} from "./libs/PaymentLib.sol";

interface IDisCONodeView {
    function periodStats(uint256 periodId)
        external
        view
        returns (uint256 love, uint256 care, uint256 anchors, uint256 federationLinks, bool harvested);

    function memberCount() external view returns (uint256);

    function createdPeriod() external view returns (uint256);
}

/// @title ProtocolTreasury — temporary commons: activity split + canon in, hybrid redistribute out
/// @dev Multi-token: native = address(0); ERC-20 via allowlist. Distribute is per-token.
contract ProtocolTreasury {
    using PaymentLib for address;

    address public governance;
    address public factory;

    uint256 public equalBps = 5000;
    uint256 public weightBps = 5000;
    uint256 public cCare = 5;
    uint256 public cLove = 3;
    uint256 public cAnchors = 1;

    mapping(address => bool) public isNode;
    address[] public nodes;

    /// @dev periodId => token => already distributed
    mapping(uint256 => mapping(address => bool)) public distributed;

    mapping(address => bool) public allowedToken;
    address[] private _allowedTokens;
    /// @dev native (address(0)) is always allowed
    bool public nativeAllowed = true;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event FactoryUpdated(address indexed previous, address indexed next);
    event NodeRegistered(address indexed node);
    event NodeRemoved(address indexed node);
    event Deposited(address indexed from, address indexed token, uint256 amount);
    event Distributed(uint256 indexed periodId, address indexed token, uint256 total, uint256 nodeCount);
    event ParamsUpdated();
    event TokenAllowed(address indexed token, bool allowed);
    event NativeAllowed(bool allowed);

    modifier onlyGovernance() {
        require(msg.sender == governance, "ProtocolTreasury: not governance");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "ProtocolTreasury: not factory");
        _;
    }

    constructor(address governance_) {
        require(governance_ != address(0), "ProtocolTreasury: zero gov");
        governance = governance_;
    }

    receive() external payable {
        emit Deposited(msg.sender, PaymentLib.NATIVE, msg.value);
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "ProtocolTreasury: zero gov");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setFactory(address next) external onlyGovernance {
        require(next != address(0), "ProtocolTreasury: zero factory");
        emit FactoryUpdated(factory, next);
        factory = next;
    }

    function setDistributeParams(uint256 equalBps_, uint256 weightBps_, uint256 cC, uint256 cL, uint256 cA)
        external
        onlyGovernance
    {
        require(equalBps_ + weightBps_ == 10000, "ProtocolTreasury: bps sum");
        equalBps = equalBps_;
        weightBps = weightBps_;
        cCare = cC;
        cLove = cL;
        cAnchors = cA;
        emit ParamsUpdated();
    }

    function setNativeAllowed(bool allowed) external onlyGovernance {
        nativeAllowed = allowed;
        emit NativeAllowed(allowed);
    }

    /// @notice Allow or disallow an ERC-20 payment token. Native is controlled via setNativeAllowed.
    function setTokenAllowed(address token, bool allowed) external onlyGovernance {
        require(token != PaymentLib.NATIVE, "ProtocolTreasury: use setNativeAllowed");
        if (allowed && !allowedToken[token]) {
            allowedToken[token] = true;
            _allowedTokens.push(token);
        } else if (!allowed && allowedToken[token]) {
            allowedToken[token] = false;
            for (uint256 i = 0; i < _allowedTokens.length; i++) {
                if (_allowedTokens[i] == token) {
                    _allowedTokens[i] = _allowedTokens[_allowedTokens.length - 1];
                    _allowedTokens.pop();
                    break;
                }
            }
        }
        emit TokenAllowed(token, allowed);
    }

    function isTokenAllowed(address token) public view returns (bool) {
        if (token == PaymentLib.NATIVE) return nativeAllowed;
        return allowedToken[token];
    }

    /// @notice Native + currently allowlisted ERC-20s (for dissolve / UI).
    function getAllowedTokens() external view returns (address[] memory out) {
        uint256 n = _allowedTokens.length + (nativeAllowed ? 1 : 0);
        out = new address[](n);
        uint256 j;
        if (nativeAllowed) {
            out[j++] = PaymentLib.NATIVE;
        }
        for (uint256 i = 0; i < _allowedTokens.length; i++) {
            out[j++] = _allowedTokens[i];
        }
    }

    function allowedTokenCount() external view returns (uint256) {
        return _allowedTokens.length + (nativeAllowed ? 1 : 0);
    }

    function registerNode(address node) external onlyFactory {
        require(node != address(0), "ProtocolTreasury: zero node");
        require(!isNode[node], "ProtocolTreasury: exists");
        isNode[node] = true;
        nodes.push(node);
        emit NodeRegistered(node);
    }

    function removeNode(address node) external onlyGovernance {
        require(isNode[node], "ProtocolTreasury: unknown");
        isNode[node] = false;
        emit NodeRemoved(node);
    }

    /// @notice Registered DisCONode may unregister itself after local dissolve.
    function selfUnregister() external {
        require(isNode[msg.sender], "ProtocolTreasury: unknown");
        isNode[msg.sender] = false;
        emit NodeRemoved(msg.sender);
    }

    function nodeCount() external view returns (uint256) {
        return nodes.length;
    }

    function getNodes() external view returns (address[] memory) {
        return nodes;
    }

    /// @notice Accept ERC-20 deposit (e.g. from DisCONode contribute/harvest). Native via receive().
    function depositToken(address token, uint256 amount) external {
        require(isTokenAllowed(token), "ProtocolTreasury: token");
        require(!PaymentLib.isNative(token), "ProtocolTreasury: use receive");
        require(amount > 0, "ProtocolTreasury: zero");
        PaymentLib.pull(token, msg.sender, amount);
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Hybrid redistribute balance of `token` to eligible nodes for a closed period.
    function distribute(uint256 periodId, address token) external {
        require(isTokenAllowed(token), "ProtocolTreasury: token");
        require(!distributed[periodId][token], "ProtocolTreasury: done");
        uint256 total = PaymentLib.balanceOf(token, address(this));
        require(total > 0, "ProtocolTreasury: empty");

        address[] memory eligible = new address[](nodes.length);
        uint256[] memory weights = new uint256[](nodes.length);
        uint256 nEligible;
        uint256 sumW;

        for (uint256 i = 0; i < nodes.length; i++) {
            address node = nodes[i];
            if (!isNode[node]) continue;

            (uint256 love, uint256 care, uint256 anchors,, bool harvested) =
                IDisCONodeView(node).periodStats(periodId);
            if (!harvested) continue;

            uint256 members = IDisCONodeView(node).memberCount();
            bool active = members >= 1 || love + care + anchors >= 1;
            if (!active) continue;

            uint256 w = cCare * care + cLove * love + cAnchors * anchors;
            eligible[nEligible] = node;
            weights[nEligible] = w;
            sumW += w;
            nEligible++;
        }

        require(nEligible > 0, "ProtocolTreasury: no eligible");

        distributed[periodId][token] = true;

        uint256 equalPool = (total * equalBps) / 10000;
        uint256 weightPool = total - equalPool;
        uint256 equalShare = equalPool / nEligible;
        uint256 paid;

        for (uint256 j = 0; j < nEligible; j++) {
            uint256 share = equalShare;
            if (sumW == 0) {
                share += weightPool / nEligible;
            } else {
                share += (weightPool * weights[j]) / sumW;
            }
            if (share == 0) continue;
            PaymentLib.push(token, eligible[j], share);
            paid += share;
        }

        emit Distributed(periodId, token, paid, nEligible);
    }
}
