// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PaymentLib} from "./libs/PaymentLib.sol";

interface ISchemaRegistry {
    function schemaExists(bytes32 schemaId) external view returns (bool);
}

interface ITokenAllowlist {
    function isTokenAllowed(address token) external view returns (bool);
    function getAllowedTokens() external view returns (address[] memory);
}

/// @title AttesterRegistry — stake-gated authorization to anchor credentials per schema
/// @dev Stake is per-token; attester meets min if any allowlisted token satisfies minStake[token].
contract AttesterRegistry {
    ISchemaRegistry public immutable schemaRegistry;
    address public governance;
    /// @dev ProtocolTreasury (token allowlist). Optional zero = native-only checks.
    address public tokenRegistry;

    /// @dev Per-token minimum stake (native = address(0))
    mapping(address => uint256) public minStake;
    uint256 public unbondDelay;

    mapping(address => mapping(bytes32 => bool)) public authorized;
    mapping(address => mapping(address => uint256)) public stakeOf; // attester => token => amount
    mapping(address => uint256) public unbondReleaseAt;
    mapping(address => bool) private unbonding;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event TokenRegistryUpdated(address indexed previous, address indexed next);
    event MinStakeUpdated(address indexed token, uint256 previous, uint256 next);
    event UnbondDelayUpdated(uint256 previous, uint256 next);
    event AttesterJoined(address indexed attester, bytes32 indexed schemaId, address indexed token, uint256 stake);
    event SchemaAdded(address indexed attester, bytes32 indexed schemaId);
    event AttesterRevoked(address indexed attester, bytes32 indexed schemaId);
    event UnbondStarted(address indexed attester, uint256 releaseAt);
    event Withdrawn(address indexed attester, address indexed token, uint256 amount);
    event Slashed(address indexed attester, address indexed token, uint256 amount, address indexed to);

    modifier onlyGovernance() {
        require(msg.sender == governance, "AttesterRegistry: not governance");
        _;
    }

    constructor(address schemaRegistry_, address governance_, uint256 minStake_, uint256 unbondDelay_) {
        require(schemaRegistry_ != address(0), "AttesterRegistry: zero schema");
        require(governance_ != address(0), "AttesterRegistry: zero governance");
        schemaRegistry = ISchemaRegistry(schemaRegistry_);
        governance = governance_;
        minStake[PaymentLib.NATIVE] = minStake_;
        unbondDelay = unbondDelay_;
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "AttesterRegistry: zero governance");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setTokenRegistry(address next) external onlyGovernance {
        emit TokenRegistryUpdated(tokenRegistry, next);
        tokenRegistry = next;
    }

    function setMinStake(address token, uint256 next) external onlyGovernance {
        emit MinStakeUpdated(token, minStake[token], next);
        minStake[token] = next;
    }

    /// @dev Back-compat: set native min stake.
    function setMinStake(uint256 next) external onlyGovernance {
        emit MinStakeUpdated(PaymentLib.NATIVE, minStake[PaymentLib.NATIVE], next);
        minStake[PaymentLib.NATIVE] = next;
    }

    function setUnbondDelay(uint256 next) external onlyGovernance {
        emit UnbondDelayUpdated(unbondDelay, next);
        unbondDelay = next;
    }

    function _tokenAllowed(address token) internal view returns (bool) {
        if (tokenRegistry == address(0)) {
            return PaymentLib.isNative(token);
        }
        return ITokenAllowlist(tokenRegistry).isTokenAllowed(token);
    }

    function _meetsMinStake(address attester) internal view returns (bool) {
        if (tokenRegistry == address(0)) {
            return stakeOf[attester][PaymentLib.NATIVE] >= minStake[PaymentLib.NATIVE];
        }
        address[] memory tokens = ITokenAllowlist(tokenRegistry).getAllowedTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (stakeOf[attester][tokens[i]] >= minStake[tokens[i]]) return true;
        }
        return false;
    }

    /// @notice Stake native or ERC-20 and join as attester for a schema.
    function stakeAndJoin(bytes32 schemaId, address token, uint256 amount) external payable {
        require(schemaRegistry.schemaExists(schemaId), "AttesterRegistry: unknown schema");
        require(!unbonding[msg.sender], "AttesterRegistry: unbonding");
        require(!authorized[msg.sender][schemaId], "AttesterRegistry: already joined");
        require(_tokenAllowed(token), "AttesterRegistry: token");

        if (amount > 0) {
            PaymentLib.pull(token, msg.sender, amount);
        } else if (PaymentLib.isNative(token)) {
            require(msg.value == 0, "AttesterRegistry: unexpected ETH");
        }

        uint256 newStake = stakeOf[msg.sender][token] + amount;
        require(newStake >= minStake[token], "AttesterRegistry: insufficient stake");

        stakeOf[msg.sender][token] = newStake;
        authorized[msg.sender][schemaId] = true;
        emit AttesterJoined(msg.sender, schemaId, token, newStake);
    }

    /// @notice Already-staked attester links another schema without extra stake (if minStake already met).
    function addSchema(bytes32 schemaId) external {
        require(schemaRegistry.schemaExists(schemaId), "AttesterRegistry: unknown schema");
        require(!unbonding[msg.sender], "AttesterRegistry: unbonding");
        require(_meetsMinStake(msg.sender), "AttesterRegistry: insufficient stake");
        require(!authorized[msg.sender][schemaId], "AttesterRegistry: already joined");
        authorized[msg.sender][schemaId] = true;
        emit SchemaAdded(msg.sender, schemaId);
    }

    /// @notice Governance shortcut for testnet / demos (no stake required).
    function authorizeAttester(address attester, bytes32 schemaId) external onlyGovernance {
        require(schemaRegistry.schemaExists(schemaId), "AttesterRegistry: unknown schema");
        authorized[attester][schemaId] = true;
        emit AttesterJoined(attester, schemaId, PaymentLib.NATIVE, stakeOf[attester][PaymentLib.NATIVE]);
    }

    function revokeAttester(address attester, bytes32 schemaId) external onlyGovernance {
        authorized[attester][schemaId] = false;
        emit AttesterRevoked(attester, schemaId);
    }

    function isAuthorized(address attester, bytes32 schemaId) external view returns (bool) {
        return authorized[attester][schemaId] && !unbonding[attester];
    }

    function startUnbond() external {
        require(_hasAnyStake(msg.sender), "AttesterRegistry: no stake");
        require(!unbonding[msg.sender], "AttesterRegistry: already unbonding");
        unbonding[msg.sender] = true;
        unbondReleaseAt[msg.sender] = block.timestamp + unbondDelay;
        emit UnbondStarted(msg.sender, unbondReleaseAt[msg.sender]);
    }

    function withdraw(address token) external {
        require(unbonding[msg.sender], "AttesterRegistry: not unbonding");
        require(block.timestamp >= unbondReleaseAt[msg.sender], "AttesterRegistry: delay");
        uint256 amount = stakeOf[msg.sender][token];
        require(amount > 0, "AttesterRegistry: no stake");
        stakeOf[msg.sender][token] = 0;
        if (!_hasAnyStake(msg.sender)) {
            unbonding[msg.sender] = false;
            unbondReleaseAt[msg.sender] = 0;
        }
        PaymentLib.push(token, msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function slash(address attester, address token, address to) external onlyGovernance {
        uint256 amount = stakeOf[attester][token];
        require(amount > 0, "AttesterRegistry: no stake");
        stakeOf[attester][token] = 0;
        if (!_hasAnyStake(attester)) {
            unbonding[attester] = false;
            unbondReleaseAt[attester] = 0;
        }
        PaymentLib.push(token, to, amount);
        emit Slashed(attester, token, amount, to);
    }

    function _hasAnyStake(address attester) internal view returns (bool) {
        if (stakeOf[attester][PaymentLib.NATIVE] > 0) return true;
        if (tokenRegistry == address(0)) return false;
        address[] memory tokens = ITokenAllowlist(tokenRegistry).getAllowedTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (PaymentLib.isNative(tokens[i])) continue;
            if (stakeOf[attester][tokens[i]] > 0) return true;
        }
        return false;
    }
}
