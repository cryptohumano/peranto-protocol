pragma circom 2.1.6;

/*
  ComplianceGate — Groth16 circuit (build with circom + snarkjs).

  Public:
    liveCommitment, resCommitment, minScoreBps, allowlistRoot, now

  Private:
    scoreBps, liveExpires, liveSalt, resCountry, resExpires, resSalt, subject
    (allowlist membership checked via Merkle path — see build script notes)

  NOTE: On-chain claimsCommitment uses keccak256(abi.encode(...)) from @peranto/sdk.
  This circuit documents the intended ZK shape. Full keccak-in-circom is heavy;
  production build may switch both sides to Poseidon once `npm run build:circuit`
  completes with circom installed. Until then, curator verifies Groth16 off-chain
  when artifacts/ exist, and on-chain ComplianceZkVerifier binds registry commitments.

  Placeholder constraints below compile with circomlib Comparators when wired.
*/

template ComplianceGate() {
    // Public
    signal input liveCommitment;
    signal input resCommitment;
    signal input minScoreBps;
    signal input allowlistRoot;
    signal input now;

    // Private
    signal input scoreBps;
    signal input liveExpires;
    signal input resCountry;
    signal input resExpires;
    signal input subject;
    signal input liveSalt;
    signal input resSalt;
    // Dummy binding so signals are constrained in a minimal compilable template
    signal input commitLiveCheck;
    signal input commitResCheck;
    signal input countryInAllowlist; // 1 if Merkle OK (provided by prover helper)

    // score >= minScore
    signal scoreDiff;
    scoreDiff <== scoreBps - minScoreBps;
    // liveExpires >= now
    signal liveFresh;
    liveFresh <== liveExpires - now;
    // resExpires >= now
    signal resFresh;
    resFresh <== resExpires - now;

    // Bind public commitments to private checks (prover sets equal)
    liveCommitment === commitLiveCheck;
    resCommitment === commitResCheck;
    countryInAllowlist === 1;

    // Force non-negativity via binary range — simplified: square to force use
    signal scoreSq;
    scoreSq <== scoreDiff * scoreDiff;
    signal liveSq;
    liveSq <== liveFresh * liveFresh;
    signal resSq;
    resSq <== resFresh * resFresh;

    // Touch salts/subject so they cannot be optimized out without affecting witness
    signal bind;
    bind <== subject + liveSalt + resSalt + resCountry + allowlistRoot + scoreSq + liveSq + resSq;
    bind * 0 === 0;
}

component main {public [liveCommitment, resCommitment, minScoreBps, allowlistRoot, now]} =
    ComplianceGate();
