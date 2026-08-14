// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PaymentLib} from "./libs/PaymentLib.sol";

interface IAttesterRegistry {
    function isAuthorized(address attester, bytes32 schemaId) external view returns (bool);
}

interface ITokenAllowlist {
    function isTokenAllowed(address token) external view returns (bool);
}

/// @title CredentialStatusRegistry — on-chain anchor / revoke for off-chain VCs
contract CredentialStatusRegistry {
    enum Status {
        None,
        Active,
        Revoked
    }

    struct Record {
        Status status;
        address attester;
        bytes32 schemaId;
        address subject;
        uint64 anchoredAt;
        uint64 validUntil;
        bytes32 claimsCommitment;
        string revokeReason;
    }

    IAttesterRegistry public immutable attesterRegistry;
    address public governance;
    address public treasury;
    /// @dev Per-token anchor fee (native = address(0))
    mapping(address => uint256) public anchorFee;

    mapping(bytes32 => Record) private records;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event TreasuryUpdated(address indexed previous, address indexed next);
    event AnchorFeeUpdated(address indexed token, uint256 previous, uint256 next);
    event CredentialAnchored(
        bytes32 indexed credHash,
        bytes32 indexed schemaId,
        address indexed attester,
        address subject
    );
    event CredentialAnchoredV2(
        bytes32 indexed credHash,
        bytes32 indexed schemaId,
        address indexed attester,
        address subject,
        uint64 validUntil,
        bytes32 claimsCommitment
    );
    event CredentialRevoked(bytes32 indexed credHash, address indexed attester, string reason);

    modifier onlyGovernance() {
        require(msg.sender == governance, "CredentialStatus: not governance");
        _;
    }

    constructor(
        address attesterRegistry_,
        address governance_,
        address treasury_,
        uint256 anchorFee_
    ) {
        require(attesterRegistry_ != address(0), "CredentialStatus: zero attester reg");
        require(governance_ != address(0), "CredentialStatus: zero governance");
        require(treasury_ != address(0), "CredentialStatus: zero treasury");
        attesterRegistry = IAttesterRegistry(attesterRegistry_);
        governance = governance_;
        treasury = treasury_;
        anchorFee[PaymentLib.NATIVE] = anchorFee_;
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "CredentialStatus: zero governance");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setTreasury(address next) external onlyGovernance {
        require(next != address(0), "CredentialStatus: zero treasury");
        emit TreasuryUpdated(treasury, next);
        treasury = next;
    }

    function setAnchorFee(address token, uint256 next) external onlyGovernance {
        emit AnchorFeeUpdated(token, anchorFee[token], next);
        anchorFee[token] = next;
    }

    /// @dev Back-compat: set native fee.
    function setAnchorFee(uint256 next) external onlyGovernance {
        emit AnchorFeeUpdated(PaymentLib.NATIVE, anchorFee[PaymentLib.NATIVE], next);
        anchorFee[PaymentLib.NATIVE] = next;
    }

    /// @dev Legacy anchor (no expiry / commitment). validUntil=0 means no on-chain TTL.
    function anchor(bytes32 credHash, bytes32 schemaId, address subject, address token, uint256 amount)
        external
        payable
    {
        _anchor(credHash, schemaId, subject, 0, bytes32(0), token, amount);
        emit CredentialAnchored(credHash, schemaId, msg.sender, subject);
    }

    /// @dev Anchor with vigencia + claims commitment for ZK gates.
    function anchorV2(
        bytes32 credHash,
        bytes32 schemaId,
        address subject,
        uint64 validUntil,
        bytes32 claimsCommitment,
        address token,
        uint256 amount
    ) external payable {
        require(validUntil > block.timestamp, "CredentialStatus: validUntil past");
        require(claimsCommitment != bytes32(0), "CredentialStatus: empty commitment");
        _anchor(credHash, schemaId, subject, validUntil, claimsCommitment, token, amount);
        emit CredentialAnchored(credHash, schemaId, msg.sender, subject);
        emit CredentialAnchoredV2(
            credHash, schemaId, msg.sender, subject, validUntil, claimsCommitment
        );
    }

    function _anchor(
        bytes32 credHash,
        bytes32 schemaId,
        address subject,
        uint64 validUntil,
        bytes32 claimsCommitment,
        address token,
        uint256 amount
    ) internal {
        require(credHash != bytes32(0), "CredentialStatus: empty hash");
        require(subject != address(0), "CredentialStatus: zero subject");
        require(records[credHash].status == Status.None, "CredentialStatus: already anchored");
        require(
            attesterRegistry.isAuthorized(msg.sender, schemaId),
            "CredentialStatus: not authorized"
        );
        require(ITokenAllowlist(treasury).isTokenAllowed(token), "CredentialStatus: token");
        require(amount >= anchorFee[token], "CredentialStatus: fee");

        if (amount > 0) {
            PaymentLib.pull(token, msg.sender, amount);
            PaymentLib.push(token, treasury, amount);
        } else if (PaymentLib.isNative(token)) {
            require(msg.value == 0, "CredentialStatus: unexpected ETH");
        }

        records[credHash] = Record({
            status: Status.Active,
            attester: msg.sender,
            schemaId: schemaId,
            subject: subject,
            anchoredAt: uint64(block.timestamp),
            validUntil: validUntil,
            claimsCommitment: claimsCommitment,
            revokeReason: ""
        });
    }

    function revoke(bytes32 credHash, string calldata reason) external {
        Record storage r = records[credHash];
        require(r.status == Status.Active, "CredentialStatus: not active");
        require(
            msg.sender == r.attester || msg.sender == governance,
            "CredentialStatus: not attester"
        );
        r.status = Status.Revoked;
        r.revokeReason = reason;
        emit CredentialRevoked(credHash, msg.sender, reason);
    }

    /// @notice Active and not past validUntil (0 = no TTL).
    function isValid(bytes32 credHash) external view returns (bool) {
        Record storage r = records[credHash];
        if (r.status != Status.Active) return false;
        if (r.validUntil != 0 && block.timestamp > r.validUntil) return false;
        return true;
    }

    function status(bytes32 credHash)
        external
        view
        returns (
            Status st,
            address attester,
            bytes32 schemaId,
            address subject,
            uint64 anchoredAt,
            string memory revokeReason
        )
    {
        Record storage r = records[credHash];
        return (r.status, r.attester, r.schemaId, r.subject, r.anchoredAt, r.revokeReason);
    }

    function statusV2(bytes32 credHash)
        external
        view
        returns (
            Status st,
            address attester,
            bytes32 schemaId,
            address subject,
            uint64 anchoredAt,
            uint64 validUntil,
            bytes32 claimsCommitment,
            string memory revokeReason
        )
    {
        Record storage r = records[credHash];
        return (
            r.status,
            r.attester,
            r.schemaId,
            r.subject,
            r.anchoredAt,
            r.validUntil,
            r.claimsCommitment,
            r.revokeReason
        );
    }
}
