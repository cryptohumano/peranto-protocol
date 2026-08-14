// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PaymentLib} from "./libs/PaymentLib.sol";

interface IProtocolTreasuryDeposit {
    function isNode(address node) external view returns (bool);
    function selfUnregister() external;
    function isTokenAllowed(address token) external view returns (bool);
    function getAllowedTokens() external view returns (address[] memory);
}

/// @title DisCONode — cooperative node: members, tips, activity fees, harvest canon
/// @dev Multi-token: native = address(0); ERC-20 must be allowlisted on ProtocolTreasury.
contract DisCONode {
    address public governance;
    address public immutable factory;
    IProtocolTreasuryDeposit public immutable protocolTreasury;

    string public name;
    uint256 public immutable periodBlocks;
    /// @dev Per-token reserve floor (native = address(0))
    mapping(address => uint256) public reserveFloor;
    uint256 public immutable createdAtBlock;
    uint256 public createdPeriod;

    uint256 public constant NODE_SHARE_BPS = 8000;
    uint256 public constant PROTOCOL_SHARE_BPS = 2000;

    uint256 public constant BPS_INTEGRATED = 200;
    uint256 public constant BPS_ISOLATED = 500;
    uint256 public constant BPS_HIGHLY = 100;
    uint256 public constant K_LINKS = 1;
    uint256 public constant N_NEW_PERIODS = 3;

    mapping(address => bool) public isMember;
    address[] private _members;

    mapping(address => uint256) public lovePoints;
    mapping(address => uint256) public carePoints;
    mapping(address => uint256) public livelihoodPoints;

    struct PeriodStats {
        uint256 love;
        uint256 care;
        uint256 anchors;
        uint256 federationLinks;
        bool harvested;
    }

    mapping(uint256 => PeriodStats) public periodStats;
    /// @dev periodId => token => canon already harvested for that token
    mapping(uint256 => mapping(address => bool)) public tokenHarvested;
    mapping(uint256 => mapping(address => bool)) private _fedLinkSeen;

    bool public dissolved;

    event MemberUpdated(address indexed account, bool joined);
    event Tipped(address indexed from, address indexed to, address indexed token, uint256 amount);
    event ActivityFee(
        address indexed from, address indexed token, uint256 toNode, uint256 toProtocol
    );
    event AnchorRecorded(address indexed actor, bytes32 indexed credHash);
    event FederationLinked(address indexed otherNode, uint256 indexed periodId);
    event Harvested(
        uint256 indexed periodId, address indexed token, uint256 amount, uint256 sustainBps
    );
    event GovernanceUpdated(address indexed previous, address indexed next);
    event ReserveFloorUpdated(address indexed token, uint256 previous, uint256 next);
    event Dissolved(address indexed residualTo, uint256 nativeAmount);
    event TokenResidual(address indexed residualTo, address indexed token, uint256 amount);
    event Seeded(address indexed from, address indexed token, uint256 amount);

    modifier onlyGovernance() {
        require(msg.sender == governance, "DisCONode: not governance");
        _;
    }

    modifier whenActive() {
        require(!dissolved, "DisCONode: dissolved");
        _;
    }

    constructor(
        address protocolTreasury_,
        address factory_,
        address governance_,
        string memory name_,
        uint256 periodBlocks_,
        uint256 reserveFloor_
    ) {
        require(protocolTreasury_ != address(0), "DisCONode: zero treasury");
        require(factory_ != address(0), "DisCONode: zero factory");
        require(governance_ != address(0), "DisCONode: zero gov");
        require(periodBlocks_ > 0, "DisCONode: period");
        protocolTreasury = IProtocolTreasuryDeposit(protocolTreasury_);
        factory = factory_;
        governance = governance_;
        name = name_;
        periodBlocks = periodBlocks_;
        reserveFloor[PaymentLib.NATIVE] = reserveFloor_;
        createdAtBlock = block.number;
        createdPeriod = block.number / periodBlocks_;
        _addMember(governance_);
    }

    receive() external payable {}

    function currentPeriod() public view returns (uint256) {
        return block.number / periodBlocks;
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }

    function setGovernance(address next) external onlyGovernance whenActive {
        require(next != address(0), "DisCONode: zero gov");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setReserveFloor(address token, uint256 next) external onlyGovernance whenActive {
        require(protocolTreasury.isTokenAllowed(token), "DisCONode: token");
        emit ReserveFloorUpdated(token, reserveFloor[token], next);
        reserveFloor[token] = next;
    }

    /// @dev Back-compat: set native reserve floor.
    function setReserveFloor(uint256 next) external onlyGovernance whenActive {
        emit ReserveFloorUpdated(PaymentLib.NATIVE, reserveFloor[PaymentLib.NATIVE], next);
        reserveFloor[PaymentLib.NATIVE] = next;
    }

    function addMember(address account) external onlyGovernance whenActive {
        _addMember(account);
    }

    function removeMember(address account) external onlyGovernance whenActive {
        require(isMember[account], "DisCONode: not member");
        require(account != governance, "DisCONode: gov member");
        isMember[account] = false;
        for (uint256 i = 0; i < _members.length; i++) {
            if (_members[i] == account) {
                _members[i] = _members[_members.length - 1];
                _members.pop();
                break;
            }
        }
        emit MemberUpdated(account, false);
    }

    /// @notice Seed node treasury with an allowlisted ERC-20 (native via receive / factory msg.value).
    function seedToken(address token, uint256 amount) external whenActive {
        require(protocolTreasury.isTokenAllowed(token), "DisCONode: token");
        require(!PaymentLib.isNative(token), "DisCONode: use native send");
        require(amount > 0, "DisCONode: zero");
        PaymentLib.pull(token, msg.sender, amount);
        emit Seeded(msg.sender, token, amount);
    }

    /// @notice Peer tip: full value to recipient; Care↑ sender, Love↑ recipient (+ period aggregates).
    /// @dev Self-tips forbidden. Tipping the node (`to == this`) keeps funds in the node treasury.
    function tip(address to, address token, uint256 amount) external payable whenActive {
        require(amount > 0, "DisCONode: zero tip");
        require(protocolTreasury.isTokenAllowed(token), "DisCONode: token");
        require(to != address(0), "DisCONode: zero to");
        require(to != msg.sender, "DisCONode: self tip");
        require(isMember[to] || to == address(this), "DisCONode: to not member");

        uint256 pid = currentPeriod();
        PeriodStats storage s = periodStats[pid];
        require(!s.harvested, "DisCONode: period closed");

        PaymentLib.pull(token, msg.sender, amount);

        carePoints[msg.sender] += 1;
        s.care += 1;

        if (to == address(this)) {
            s.love += 1;
        } else {
            lovePoints[to] += 1;
            s.love += 1;
            PaymentLib.push(token, to, amount);
        }

        emit Tipped(msg.sender, to, token, amount);
    }

    /// @notice Route livelihood/activity fee: 80% node treasury, 20% protocol (same token).
    function contribute(address token, uint256 amount) external payable whenActive {
        require(amount > 0, "DisCONode: zero");
        require(protocolTreasury.isTokenAllowed(token), "DisCONode: token");
        uint256 pid = currentPeriod();
        require(!periodStats[pid].harvested, "DisCONode: period closed");

        PaymentLib.pull(token, msg.sender, amount);

        uint256 toProtocol = (amount * PROTOCOL_SHARE_BPS) / 10000;
        uint256 toNode = amount - toProtocol;
        if (toProtocol > 0) {
            _sendToTreasury(token, toProtocol);
        }
        livelihoodPoints[msg.sender] += 1;
        emit ActivityFee(msg.sender, token, toNode, toProtocol);
    }

    function recordAnchor(bytes32 credHash) external whenActive {
        require(isMember[msg.sender], "DisCONode: not member");
        uint256 pid = currentPeriod();
        PeriodStats storage s = periodStats[pid];
        require(!s.harvested, "DisCONode: period closed");
        s.anchors += 1;
        emit AnchorRecorded(msg.sender, credHash);
    }

    function addFederationLink(address otherNode) external onlyGovernance whenActive {
        require(otherNode != address(0) && otherNode != address(this), "DisCONode: bad node");
        require(protocolTreasury.isNode(otherNode), "DisCONode: other not registered");
        uint256 pid = currentPeriod();
        PeriodStats storage s = periodStats[pid];
        require(!s.harvested, "DisCONode: period closed");
        if (_fedLinkSeen[pid][otherNode]) return;
        _fedLinkSeen[pid][otherNode] = true;
        s.federationLinks += 1;
        emit FederationLinked(otherNode, pid);
    }

    function sustainBpsFor(uint256 periodId) public view returns (uint256) {
        PeriodStats storage s = periodStats[periodId];
        uint256 age = periodId >= createdPeriod ? periodId - createdPeriod : 0;
        bool hasLove = s.love > 0;
        uint256 links = s.federationLinks;
        bool highly = hasLove && links >= (2 * K_LINKS);
        bool integrated = hasLove || links >= K_LINKS;
        bool isolatedOrNew = (!integrated) && (age < N_NEW_PERIODS || (!hasLove && links == 0));

        if (highly) return BPS_HIGHLY;
        if (integrated) return BPS_INTEGRATED;
        if (isolatedOrNew || !integrated) return BPS_ISOLATED;
        return BPS_INTEGRATED;
    }

    /// @notice Permissionless harvest of canon for one token in a closed period.
    function harvest(uint256 periodId, address token) external whenActive {
        require(protocolTreasury.isTokenAllowed(token), "DisCONode: token");
        require(periodId < currentPeriod(), "DisCONode: period open");
        PeriodStats storage s = periodStats[periodId];
        require(!tokenHarvested[periodId][token], "DisCONode: harvested");

        if (!s.harvested) {
            s.harvested = true;
        }
        tokenHarvested[periodId][token] = true;

        uint256 bal = PaymentLib.balanceOf(token, address(this));
        uint256 floor = reserveFloor[token];
        uint256 bps = sustainBpsFor(periodId);
        uint256 amount;
        if (bal > floor) {
            uint256 base = bal - floor;
            amount = (base * bps) / 10000;
        }
        if (amount > 0) {
            _sendToTreasury(token, amount);
        }
        emit Harvested(periodId, token, amount, bps);
    }

    function withdraw(address to, address token, uint256 amount) external onlyGovernance whenActive {
        require(to != address(0), "DisCONode: zero to");
        require(protocolTreasury.isTokenAllowed(token), "DisCONode: token");
        require(amount <= PaymentLib.balanceOf(token, address(this)), "DisCONode: bal");
        PaymentLib.push(token, to, amount);
    }

    /// @notice Liquidate node: empty members, send residual of all allowlisted tokens, unregister.
    function dissolve(address payable residualTo) external onlyGovernance whenActive {
        require(residualTo != address(0), "DisCONode: zero to");
        dissolved = true;

        for (uint256 i = 0; i < _members.length; i++) {
            address account = _members[i];
            isMember[account] = false;
            emit MemberUpdated(account, false);
        }
        delete _members;

        address[] memory tokens = protocolTreasury.getAllowedTokens();
        uint256 nativeBal;
        for (uint256 t = 0; t < tokens.length; t++) {
            address token = tokens[t];
            uint256 bal = PaymentLib.balanceOf(token, address(this));
            if (bal == 0) continue;
            if (PaymentLib.isNative(token)) {
                nativeBal = bal;
            }
            PaymentLib.push(token, residualTo, bal);
            emit TokenResidual(residualTo, token, bal);
        }

        protocolTreasury.selfUnregister();
        emit Dissolved(residualTo, nativeBal);
    }

    function _sendToTreasury(address token, uint256 amount) internal {
        PaymentLib.push(token, address(protocolTreasury), amount);
    }

    function _addMember(address account) internal {
        require(account != address(0), "DisCONode: zero");
        if (isMember[account]) return;
        isMember[account] = true;
        _members.push(account);
        emit MemberUpdated(account, true);
    }
}
