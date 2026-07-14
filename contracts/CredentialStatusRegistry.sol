// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAttesterRegistry {
    function isAuthorized(address attester, bytes32 schemaId) external view returns (bool);
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
        string revokeReason;
    }

    IAttesterRegistry public immutable attesterRegistry;
    address public governance;
    address public treasury;
    uint256 public anchorFee;

    mapping(bytes32 => Record) private records;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event TreasuryUpdated(address indexed previous, address indexed next);
    event AnchorFeeUpdated(uint256 previous, uint256 next);
    event CredentialAnchored(
        bytes32 indexed credHash,
        bytes32 indexed schemaId,
        address indexed attester,
        address subject
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
        anchorFee = anchorFee_;
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

    function setAnchorFee(uint256 next) external onlyGovernance {
        emit AnchorFeeUpdated(anchorFee, next);
        anchorFee = next;
    }

    function anchor(bytes32 credHash, bytes32 schemaId, address subject) external payable {
        require(credHash != bytes32(0), "CredentialStatus: empty hash");
        require(subject != address(0), "CredentialStatus: zero subject");
        require(records[credHash].status == Status.None, "CredentialStatus: already anchored");
        require(
            attesterRegistry.isAuthorized(msg.sender, schemaId),
            "CredentialStatus: not authorized"
        );
        require(msg.value >= anchorFee, "CredentialStatus: fee");

        if (msg.value > 0) {
            (bool ok,) = treasury.call{value: msg.value}("");
            require(ok, "CredentialStatus: fee transfer failed");
        }

        records[credHash] = Record({
            status: Status.Active,
            attester: msg.sender,
            schemaId: schemaId,
            subject: subject,
            anchoredAt: uint64(block.timestamp),
            revokeReason: ""
        });

        emit CredentialAnchored(credHash, schemaId, msg.sender, subject);
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
}
