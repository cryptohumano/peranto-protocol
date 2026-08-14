# @peranto/zk-compliance

Groth16 **ComplianceGate** for the bounty compliance flow (liveness + residence + vigencia).

## What it proves

`notExpired ∧ scoreBps ≥ minScoreBps ∧ country ∈ allowlist`, binding public `claimsCommitment`s that were anchored via `CredentialStatusRegistry.anchorV2`.

## Build circuit (optional)

Requires [circom](https://docs.circom.io/) 2.x on `PATH`:

```bash
npm run build:circuit -w @peranto/zk-compliance
# then follow artifacts/NEXT_STEPS.txt (snarkjs ptau + zkey + solidityverifier)
```

Without circom, the registry + algebraic helpers in `@peranto/sdk` still enforce vigencia and policy for holder self-checks. On-chain gate: `ComplianceZkVerifier`.

## On-chain

[`contracts/ComplianceZkVerifier.sol`](../../contracts/ComplianceZkVerifier.sol) checks `isValid` + commitment match + optional Groth16 verifier address.
