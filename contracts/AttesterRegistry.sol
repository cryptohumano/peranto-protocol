// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISchemaRegistry {
    function schemaExists(bytes32 schemaId) external view returns (bool);
}

/// @title AttesterRegistry — stake-gated authorization to anchor credentials per schema
contract AttesterRegistry {
    ISchemaRegistry public immutable schemaRegistry;
    address public governance;

    uint256 public minStake;
    uint256 public unbondDelay;

    mapping(address => mapping(bytes32 => bool)) public authorized;
    mapping(address => uint256) public stakeOf;
    mapping(address => uint256) public unbondReleaseAt;
    mapping(address => bool) private unbonding;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event MinStakeUpdated(uint256 previous, uint256 next);
    event UnbondDelayUpdated(uint256 previous, uint256 next);
    event AttesterJoined(address indexed attester, bytes32 indexed schemaId, uint256 stake);
    event SchemaAdded(address indexed attester, bytes32 indexed schemaId);
    event AttesterRevoked(address indexed attester, bytes32 indexed schemaId);
    event UnbondStarted(address indexed attester, uint256 releaseAt);
    event Withdrawn(address indexed attester, uint256 amount);
    event Slashed(address indexed attester, uint256 amount, address indexed to);

    modifier onlyGovernance() {
        require(msg.sender == governance, "AttesterRegistry: not governance");
        _;
    }

    constructor(address schemaRegistry_, address governance_, uint256 minStake_, uint256 unbondDelay_) {
        require(schemaRegistry_ != address(0), "AttesterRegistry: zero schema");
        require(governance_ != address(0), "AttesterRegistry: zero governance");
        schemaRegistry = ISchemaRegistry(schemaRegistry_);
        governance = governance_;
        minStake = minStake_;
        unbondDelay = unbondDelay_;
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "AttesterRegistry: zero governance");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setMinStake(uint256 next) external onlyGovernance {
        emit MinStakeUpdated(minStake, next);
        minStake = next;
    }

    function setUnbondDelay(uint256 next) external onlyGovernance {
        emit UnbondDelayUpdated(unbondDelay, next);
        unbondDelay = next;
    }

    /// @notice Stake native token and join as attester for a schema (permissionless entry).
    function stakeAndJoin(bytes32 schemaId) external payable {
        require(schemaRegistry.schemaExists(schemaId), "AttesterRegistry: unknown schema");
        require(!unbonding[msg.sender], "AttesterRegistry: unbonding");
        require(!authorized[msg.sender][schemaId], "AttesterRegistry: already joined");

        uint256 newStake = stakeOf[msg.sender] + msg.value;
        require(newStake >= minStake, "AttesterRegistry: insufficient stake");

        stakeOf[msg.sender] = newStake;
        authorized[msg.sender][schemaId] = true;
        emit AttesterJoined(msg.sender, schemaId, newStake);
    }

    /// @notice Already-staked attester links another schema without extra stake (if minStake already met).
    function addSchema(bytes32 schemaId) external {
        require(schemaRegistry.schemaExists(schemaId), "AttesterRegistry: unknown schema");
        require(!unbonding[msg.sender], "AttesterRegistry: unbonding");
        require(stakeOf[msg.sender] >= minStake, "AttesterRegistry: insufficient stake");
        require(!authorized[msg.sender][schemaId], "AttesterRegistry: already joined");
        authorized[msg.sender][schemaId] = true;
        emit SchemaAdded(msg.sender, schemaId);
    }

    /// @notice Governance shortcut for testnet / demos (no stake required).
    function authorizeAttester(address attester, bytes32 schemaId) external onlyGovernance {
        require(schemaRegistry.schemaExists(schemaId), "AttesterRegistry: unknown schema");
        authorized[attester][schemaId] = true;
        emit AttesterJoined(attester, schemaId, stakeOf[attester]);
    }

    function revokeAttester(address attester, bytes32 schemaId) external onlyGovernance {
        authorized[attester][schemaId] = false;
        emit AttesterRevoked(attester, schemaId);
    }

    function isAuthorized(address attester, bytes32 schemaId) external view returns (bool) {
        return authorized[attester][schemaId] && !unbonding[attester];
    }

    function startUnbond() external {
        require(stakeOf[msg.sender] > 0, "AttesterRegistry: no stake");
        require(!unbonding[msg.sender], "AttesterRegistry: already unbonding");
        unbonding[msg.sender] = true;
        unbondReleaseAt[msg.sender] = block.timestamp + unbondDelay;
        emit UnbondStarted(msg.sender, unbondReleaseAt[msg.sender]);
    }

    function withdraw() external {
        require(unbonding[msg.sender], "AttesterRegistry: not unbonding");
        require(block.timestamp >= unbondReleaseAt[msg.sender], "AttesterRegistry: delay");
        uint256 amount = stakeOf[msg.sender];
        stakeOf[msg.sender] = 0;
        unbonding[msg.sender] = false;
        unbondReleaseAt[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "AttesterRegistry: transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function slash(address attester, address to) external onlyGovernance {
        uint256 amount = stakeOf[attester];
        require(amount > 0, "AttesterRegistry: no stake");
        stakeOf[attester] = 0;
        unbonding[attester] = false;
        unbondReleaseAt[attester] = 0;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "AttesterRegistry: slash transfer failed");
        emit Slashed(attester, amount, to);
    }
}
