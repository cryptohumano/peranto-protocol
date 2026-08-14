// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DisCONode} from "./DisCONode.sol";
import {PaymentLib} from "./libs/PaymentLib.sol";

interface IProtocolTreasuryRegister {
    function registerNode(address node) external;
    function setFactory(address next) external;
    function isTokenAllowed(address token) external view returns (bool);
}

/// @title DisCOFactory — deploys DisCONode instances into ProtocolTreasury registry
contract DisCOFactory {
    address public governance;
    IProtocolTreasuryRegister public immutable protocolTreasury;
    uint256 public periodBlocks;
    uint256 public defaultReserveFloor;

    address[] public allNodes;
    mapping(address => address) public nodeByCreator;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event ParamsUpdated(uint256 periodBlocks, uint256 reserveFloor);
    event NodeCreated(address indexed node, address indexed creator, string name);
    event NodeSeeded(
        address indexed node, address indexed creator, address indexed token, uint256 amount, uint256 reserveFloor
    );

    modifier onlyGovernance() {
        require(msg.sender == governance, "DisCOFactory: not governance");
        _;
    }

    constructor(address protocolTreasury_, address governance_, uint256 periodBlocks_, uint256 reserveFloor_) {
        require(protocolTreasury_ != address(0), "DisCOFactory: zero treasury");
        require(governance_ != address(0), "DisCOFactory: zero gov");
        require(periodBlocks_ > 0, "DisCOFactory: period");
        protocolTreasury = IProtocolTreasuryRegister(protocolTreasury_);
        governance = governance_;
        periodBlocks = periodBlocks_;
        defaultReserveFloor = reserveFloor_;
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "DisCOFactory: zero gov");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setParams(uint256 periodBlocks_, uint256 reserveFloor_) external onlyGovernance {
        require(periodBlocks_ > 0, "DisCOFactory: period");
        periodBlocks = periodBlocks_;
        defaultReserveFloor = reserveFloor_;
        emit ParamsUpdated(periodBlocks_, reserveFloor_);
    }

    /// @notice Create a DisCO node. Optional msg.value seeds native treasury (100% to the node).
    function createNode(string calldata name_) external payable returns (address node) {
        return _create(name_, defaultReserveFloor, PaymentLib.NATIVE, msg.value);
    }

    /// @notice Create with custom native reserveFloor + optional native seed.
    function createNodeWithConfig(string calldata name_, uint256 reserveFloor_)
        external
        payable
        returns (address node)
    {
        return _create(name_, reserveFloor_, PaymentLib.NATIVE, msg.value);
    }

    /// @notice Create and seed with an allowlisted ERC-20 (approve factory first).
    function createNodeWithTokenSeed(
        string calldata name_,
        uint256 reserveFloor_,
        address token,
        uint256 amount
    ) external returns (address node) {
        require(!PaymentLib.isNative(token), "DisCOFactory: use payable create");
        require(protocolTreasury.isTokenAllowed(token), "DisCOFactory: token");
        require(amount > 0, "DisCOFactory: zero seed");
        node = _create(name_, reserveFloor_, token, amount);
    }

    function _create(string memory name_, uint256 reserveFloor_, address seedToken, uint256 seedAmount)
        internal
        returns (address node)
    {
        if (PaymentLib.isNative(seedToken)) {
            require(msg.value == seedAmount, "DisCOFactory: bad value");
        } else {
            require(msg.value == 0, "DisCOFactory: unexpected ETH");
        }

        DisCONode deployed = new DisCONode(
            address(protocolTreasury),
            address(this),
            msg.sender,
            name_,
            periodBlocks,
            reserveFloor_
        );
        node = address(deployed);
        allNodes.push(node);
        nodeByCreator[msg.sender] = node;
        protocolTreasury.registerNode(node);
        emit NodeCreated(node, msg.sender, name_);

        if (seedAmount > 0) {
            if (PaymentLib.isNative(seedToken)) {
                (bool ok,) = node.call{value: seedAmount}("");
                require(ok, "DisCOFactory: seed failed");
            } else {
                PaymentLib.pull(seedToken, msg.sender, seedAmount);
                PaymentLib.push(seedToken, node, seedAmount);
            }
            emit NodeSeeded(node, msg.sender, seedToken, seedAmount, reserveFloor_);
        }
    }

    function nodeCount() external view returns (uint256) {
        return allNodes.length;
    }
}
