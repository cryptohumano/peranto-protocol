// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IProtocolTreasuryDeposit {
    function isNode(address node) external view returns (bool);
    function selfUnregister() external;
}

/// @title DisCONode — cooperative node: members, tips, activity fees, harvest canon
contract DisCONode {
    address public governance;
    address public immutable factory;
    IProtocolTreasuryDeposit public immutable protocolTreasury;

    string public name;
    uint256 public immutable periodBlocks;
    uint256 public reserveFloor;
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
    mapping(uint256 => mapping(address => bool)) private _fedLinkSeen;

    bool public dissolved;

    event MemberUpdated(address indexed account, bool joined);
    event Tipped(address indexed from, address indexed to, uint256 amount);
    event ActivityFee(address indexed from, uint256 toNode, uint256 toProtocol);
    event AnchorRecorded(address indexed actor, bytes32 indexed credHash);
    event FederationLinked(address indexed otherNode, uint256 indexed periodId);
    event Harvested(uint256 indexed periodId, uint256 amount, uint256 sustainBps);
    event GovernanceUpdated(address indexed previous, address indexed next);
    event ReserveFloorUpdated(uint256 previous, uint256 next);
    event Dissolved(address indexed residualTo, uint256 amount);

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
        reserveFloor = reserveFloor_;
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

    function setReserveFloor(uint256 next) external onlyGovernance whenActive {
        emit ReserveFloorUpdated(reserveFloor, next);
        reserveFloor = next;
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

    /// @notice Peer tip: full value to recipient; Care↑ sender, Love↑ recipient (+ period aggregates).
    /// @dev Self-tips forbidden: would mint Care+Love with zero PAS transfer and inflate period weight / sustainBps.
    ///      Tipping the node (`to == this`) remains allowed (Care↑ sender, period Love↑, PAS stays in treasury).
    function tip(address to) external payable whenActive {
        require(msg.value > 0, "DisCONode: zero tip");
        require(to != address(0), "DisCONode: zero to");
        require(to != msg.sender, "DisCONode: self tip");
        require(isMember[to] || to == address(this), "DisCONode: to not member");

        uint256 pid = currentPeriod();
        PeriodStats storage s = periodStats[pid];
        require(!s.harvested, "DisCONode: period closed");

        carePoints[msg.sender] += 1;
        s.care += 1;

        if (to == address(this)) {
            s.love += 1;
        } else {
            lovePoints[to] += 1;
            s.love += 1;
            (bool ok,) = to.call{value: msg.value}("");
            require(ok, "DisCONode: tip transfer");
        }

        emit Tipped(msg.sender, to, msg.value);
    }

    /// @notice Route livelihood/activity fee: 80% node treasury, 20% protocol.
    function contribute() external payable whenActive {
        require(msg.value > 0, "DisCONode: zero");
        uint256 pid = currentPeriod();
        require(!periodStats[pid].harvested, "DisCONode: period closed");

        uint256 toProtocol = (msg.value * PROTOCOL_SHARE_BPS) / 10000;
        uint256 toNode = msg.value - toProtocol;
        if (toProtocol > 0) {
            (bool ok,) = address(protocolTreasury).call{value: toProtocol}("");
            require(ok, "DisCONode: protocol fee");
        }
        livelihoodPoints[msg.sender] += 1;
        emit ActivityFee(msg.sender, toNode, toProtocol);
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

    /// @notice Permissionless harvest of canon for a past or current-closed intent period.
    function harvest(uint256 periodId) external whenActive {
        require(periodId < currentPeriod(), "DisCONode: period open");
        PeriodStats storage s = periodStats[periodId];
        require(!s.harvested, "DisCONode: harvested");

        s.harvested = true;
        uint256 bal = address(this).balance;
        uint256 bps = sustainBpsFor(periodId);
        uint256 amount;
        if (bal > reserveFloor) {
            uint256 base = bal - reserveFloor;
            amount = (base * bps) / 10000;
        }
        if (amount > 0) {
            (bool ok,) = address(protocolTreasury).call{value: amount}("");
            require(ok, "DisCONode: harvest send");
        }
        emit Harvested(periodId, amount, bps);
    }

    function withdraw(address to, uint256 amount) external onlyGovernance whenActive {
        require(to != address(0), "DisCONode: zero to");
        require(amount <= address(this).balance, "DisCONode: bal");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "DisCONode: withdraw");
    }

    /// @notice Liquidate node: empty members, send residual balance, unregister from ProtocolTreasury.
    /// @dev Does NOT revoke JWT credential anchors — callers should revoke Member VCs separately.
    function dissolve(address payable residualTo) external onlyGovernance whenActive {
        require(residualTo != address(0), "DisCONode: zero to");
        dissolved = true;

        for (uint256 i = 0; i < _members.length; i++) {
            address account = _members[i];
            isMember[account] = false;
            emit MemberUpdated(account, false);
        }
        delete _members;

        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = residualTo.call{value: bal}("");
            require(ok, "DisCONode: dissolve send");
        }

        protocolTreasury.selfUnregister();
        emit Dissolved(residualTo, bal);
    }

    function _addMember(address account) internal {
        require(account != address(0), "DisCONode: zero");
        if (isMember[account]) return;
        isMember[account] = true;
        _members.push(account);
        emit MemberUpdated(account, true);
    }
}
