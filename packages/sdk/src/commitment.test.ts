import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLivenessCommitment,
  buildResidenceCommitment,
  computeClaimsCommitment,
  CLAIMS_SCHEMA_KIND,
  countryToCode,
} from "./commitment.ts";
import {
  computeAllowlistRoot,
  proveComplianceGateAlgebraic,
  verifyComplianceGatePublic,
} from "./compliance-zk.ts";
import type { Address, Hex } from "viem";

const subject = "0x1234567890123456789012345678901234567890" as Address;

describe("claims commitment", () => {
  it("is deterministic", () => {
    const salt =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
    const a = buildLivenessCommitment({
      score: 0.95,
      expiresAt: 1_700_000_000,
      subject,
      salt,
    });
    const b = computeClaimsCommitment({
      schemaKind: CLAIMS_SCHEMA_KIND.Liveness,
      countryCode: 0,
      scoreBps: 9500,
      expiresAtUnix: 1_700_000_000,
      subject,
      salt,
    });
    assert.equal(a.commitment, b);
    assert.equal(a.scoreBps, 9500);
  });

  it("encodes country MX", () => {
    assert.equal(countryToCode("MX"), 1324);
  });
});

describe("compliance algebraic gate", () => {
  it("proves and verifies allowlisted residence + liveness", () => {
    const now = 1_700_000_000;
    const live = buildLivenessCommitment({
      score: 0.97,
      expiresAt: now + 86400,
      subject,
    });
    const res = buildResidenceCommitment({
      country: "MX",
      expiresAt: now + 86400 * 30,
      subject,
    });
    const witness = {
      live: {
        scoreBps: live.scoreBps,
        expiresAtUnix: live.expiresAtUnix,
        subject,
        salt: live.salt,
        commitment: live.commitment,
        credHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      },
      residence: {
        country: "MX",
        expiresAtUnix: res.expiresAtUnix,
        subject,
        salt: res.salt,
        commitment: res.commitment,
        credHash:
          "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      },
    };
    const policy = {
      minScoreBps: 9000,
      allowlist: ["MX", "CO", "AR"],
      now,
    };
    const proof = proveComplianceGateAlgebraic(witness, policy);
    assert.equal(proof.mode, "algebraic");
    assert.equal(
      proof.publicSignals.allowlistRoot,
      computeAllowlistRoot(policy.allowlist)
    );
    const v = verifyComplianceGatePublic(proof, {
      liveCommitment: live.commitment,
      resCommitment: res.commitment,
      policy,
    });
    assert.equal(v.ok, true);
  });

  it("rejects country outside allowlist", () => {
    const now = 1_700_000_000;
    const live = buildLivenessCommitment({
      score: 0.99,
      expiresAt: now + 100,
      subject,
    });
    const res = buildResidenceCommitment({
      country: "RU",
      expiresAt: now + 100,
      subject,
    });
    assert.throws(() =>
      proveComplianceGateAlgebraic(
        {
          live: {
            scoreBps: live.scoreBps,
            expiresAtUnix: live.expiresAtUnix,
            subject,
            salt: live.salt,
            commitment: live.commitment,
            credHash:
              "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
          },
          residence: {
            country: "RU",
            expiresAtUnix: res.expiresAtUnix,
            subject,
            salt: res.salt,
            commitment: res.commitment,
            credHash:
              "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
          },
        },
        { minScoreBps: 1, allowlist: ["MX"], now }
      )
    );
  });
});
