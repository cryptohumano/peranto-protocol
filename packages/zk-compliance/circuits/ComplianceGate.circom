pragma circom 2.1.6;

/*
  Deprecated: ComplianceGate is now Noir + UltraHonk (bb).
  See packages/zk-compliance/noir/src/main.nr
  Poseidon commitments: @peranto/sdk computeClaimsCommitment
*/
template ComplianceGateDeprecated() {
    signal input dummy;
    dummy === dummy;
}

component main = ComplianceGateDeprecated();
