# @peranto/zk-compliance

Noir **ComplianceGate** proved with Barretenberg **UltraHonk** (`bb` / `@aztec/bb.js`).

Opens Poseidon-128 claims commitments from `@peranto/sdk` (`hash_7` / Circom-compatible):

`notExpired ∧ scoreBps ≥ minScoreBps ∧ country ∈ allowlist`

## Prereqs

- [Nargo](https://noir-lang.org/) 1.0.x (`nargo --version`)
- [bb](https://github.com/AztecProtocol/aztec-packages) 5.x (`bb --version`) matching `@aztec/bb.js`

## Build circuit

```bash
npm run build:circuit -w @peranto/zk-compliance
```

Writes `packages/zk-compliance/circuit.json` (committed). Without nargo the script skips.

## Prove / verify (Node)

```bash
npm test -w @peranto/zk-compliance
```

Uses `bb` via Unix socket when the binary is on `PATH`, otherwise WASM.

Aura keeps salts in the vault and generates an **UltraHonk** proof in the popup (`bb.js` WASM). The attester verifies that proof off-chain. On-chain `ComplianceZkVerifier.verifyGateHonk` calls the generated `HonkVerifier` once `setHonk` is set.

```bash
npm run export-verifier -w @peranto/zk-compliance
```
