# On-chain UltraHonk verifier

`bb write_solidity_verifier -t evm` emits `packages/zk-compliance/artifacts/HonkVerifier.sol` (~2460 lines, keccak ZK).

Hardhat 0.8.24/0.8.27 + viaIR still hits **stack too deep** (`YulException`) on that file. Do not copy it into `contracts/` until solc/bb can compile it (Foundry + via_ir, or `bb --optimized` when ZK optimized lands).

Until then:

- Aura generates the Honk proof in the popup (`verifierTarget: "evm"`).
- The attester verifies it off-chain with `verifyComplianceGateHonk`.
- `ComplianceZkVerifier.verifyGateHonk` is the on-chain slot: governance `setHonk(address)` once a compiled `HonkVerifier` is deployed.

Regenerate:

```bash
npm run export-verifier -w @peranto/zk-compliance
```

(writes `artifacts/vk` + `artifacts/HonkVerifier.sol`)
