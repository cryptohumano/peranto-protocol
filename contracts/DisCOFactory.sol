// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DisCONode} from "./DisCONode.sol";

interface IProtocolTreasuryRegister {
    function registerNode(address node) external;
    function setFactory(address next) external;
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
    event NodeSeeded(address indexed node, address indexed creator, uint256 amount, uint256 reserveFloor);

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

    /// @notice Create a DisCO node. Optional msg.value seeds the node treasury (100% to the node).
    function createNode(string calldata name_) external payable returns (address node) {
        return _create(name_, defaultReserveFloor);
    }

    /// @notice Create with custom reserveFloor + optional seed treasury.
    function createNodeWithConfig(string calldata name_, uint256 reserveFloor_)
        external
        payable
        returns (address node)
    {
        return _create(name_, reserveFloor_);
    }

    function _create(string memory name_, uint256 reserveFloor_) internal returns (address node) {
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

        if (msg.value > 0) {
            (bool ok,) = node.call{value: msg.value}("");
            require(ok, "DisCOFactory: seed failed");
            emit NodeSeeded(node, msg.sender, msg.value, reserveFloor_);
        }
    }

    function nodeCount() external view returns (uint256) {
        return allNodes.length;
    }
}
