// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICredentialStatusV2 {
    function isValid(bytes32 credHash) external view returns (bool);

    function statusV2(bytes32 credHash)
        external
        view
        returns (
            uint8 st,
            address attester,
            bytes32 schemaId,
            address subject,
            uint64 anchoredAt,
            uint64 validUntil,
            bytes32 claimsCommitment,
            string memory revokeReason
        );
}

/// @dev Optional Groth16 verifier (snarkjs export). address(0) = off-chain proofs only.
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool);
}

/**
 * @title ComplianceZkVerifier
 * @notice Curator gate: both compliance creds must be isValid on-chain,
 *         public commitments must match registry, and (if configured) Groth16 proof.
 */
contract ComplianceZkVerifier {
    ICredentialStatusV2 public immutable credentialStatus;
    IGroth16Verifier public groth16;
    address public governance;

    uint256 public minScoreBps;
    bytes32 public allowlistRoot;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event Groth16Updated(address indexed previous, address indexed next);
    event PolicyUpdated(uint256 minScoreBps, bytes32 allowlistRoot);
    event GateVerified(
        bytes32 indexed liveCredHash,
        bytes32 indexed resCredHash,
        address indexed subject,
        bool usedGroth16
    );

    modifier onlyGovernance() {
        require(msg.sender == governance, "ComplianceZk: not governance");
        _;
    }

    constructor(
        address credentialStatus_,
        address governance_,
        uint256 minScoreBps_,
        bytes32 allowlistRoot_
    ) {
        require(credentialStatus_ != address(0), "ComplianceZk: zero registry");
        require(governance_ != address(0), "ComplianceZk: zero governance");
        credentialStatus = ICredentialStatusV2(credentialStatus_);
        governance = governance_;
        minScoreBps = minScoreBps_;
        allowlistRoot = allowlistRoot_;
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "ComplianceZk: zero governance");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setGroth16(address next) external onlyGovernance {
        emit Groth16Updated(address(groth16), next);
        groth16 = IGroth16Verifier(next);
    }

    function setPolicy(uint256 minScoreBps_, bytes32 allowlistRoot_) external onlyGovernance {
        minScoreBps = minScoreBps_;
        allowlistRoot = allowlistRoot_;
        emit PolicyUpdated(minScoreBps_, allowlistRoot_);
    }

    /**
     * @param liveCredHash LivenessCheck credential hash
     * @param resCredHash ProofOfResidence credential hash
     * @param nowTs Public time bound (must be <= block.timestamp + 300 and >= block.timestamp - 3600)
     * @param a Groth16 proof A (zeroed if groth16 unset — then only registry checks)
     * @param b Groth16 proof B
     * @param c Groth16 proof C
     * @param publicInputs [liveCommitment, resCommitment, minScoreBps, allowlistRoot, now]
     *        commitments encoded as uint256(uint160 left) not — full bytes32 as uint256
     */
    function verifyGate(
        bytes32 liveCredHash,
        bytes32 resCredHash,
        uint64 nowTs,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata publicInputs
    ) external returns (bool) {
        require(credentialStatus.isValid(liveCredHash), "ComplianceZk: live invalid");
        require(credentialStatus.isValid(resCredHash), "ComplianceZk: res invalid");

        require(
            nowTs + 3600 >= block.timestamp && nowTs <= block.timestamp + 300,
            "ComplianceZk: now out of window"
        );

        (
            ,
            ,
            ,
            address liveSubject,
            ,
            ,
            bytes32 liveCommit,
        ) = credentialStatus.statusV2(liveCredHash);
        (
            ,
            ,
            ,
            address resSubject,
            ,
            ,
            bytes32 resCommit,
        ) = credentialStatus.statusV2(resCredHash);

        require(liveSubject != address(0) && liveSubject == resSubject, "ComplianceZk: subject");
        require(liveCommit == bytes32(publicInputs[0]), "ComplianceZk: live commit");
        require(resCommit == bytes32(publicInputs[1]), "ComplianceZk: res commit");
        require(publicInputs[2] == minScoreBps, "ComplianceZk: minScore");
        require(bytes32(publicInputs[3]) == allowlistRoot, "ComplianceZk: allowlist");
        require(publicInputs[4] == uint256(nowTs), "ComplianceZk: now signal");

        bool usedGroth16 = false;
        if (address(groth16) != address(0)) {
            uint256[] memory inputs = new uint256[](5);
            for (uint256 i = 0; i < 5; i++) {
                inputs[i] = publicInputs[i];
            }
            require(groth16.verifyProof(a, b, c, inputs), "ComplianceZk: bad proof");
            usedGroth16 = true;
        } else {
            // Without on-chain groth16, registry+policy binding still holds;
            // claim values stay off-chain (ZK proof verified off-chain by curator SDK).
            require(a[0] == 0 && a[1] == 0 && c[0] == 0 && c[1] == 0, "ComplianceZk: unexpected proof");
        }

        emit GateVerified(liveCredHash, resCredHash, liveSubject, usedGroth16);
        return true;
    }

    function previewValid(bytes32 liveCredHash, bytes32 resCredHash)
        external
        view
        returns (bool liveOk, bool resOk, address subject, bytes32 liveCommit, bytes32 resCommit)
    {
        liveOk = credentialStatus.isValid(liveCredHash);
        resOk = credentialStatus.isValid(resCredHash);
        (, , , subject, , , liveCommit, ) = credentialStatus.statusV2(liveCredHash);
        address resSubject;
        (, , , resSubject, , , resCommit, ) = credentialStatus.statusV2(resCredHash);
        if (subject != resSubject) subject = address(0);
    }
}
