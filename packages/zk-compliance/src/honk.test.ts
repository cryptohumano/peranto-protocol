import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import {
  buildLivenessCommitment,
  buildResidenceCommitment,
} from "@peranto/sdk";
import {
  honkArtifactsReady,
  proveComplianceGateHonk,
  verifyComplianceGateHonk,
} from "./honk.ts";

const subject = "0x1234567890123456789012345678901234567890" as Address;

describe("UltraHonk compliance gate", () => {
  it("has circuit artifact", () => {
    assert.equal(honkArtifactsReady(), true);
  });

  it("proves and verifies with bb", async () => {
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
    const policy = {
      minScoreBps: 9000,
      allowlist: ["MX", "CO", "AR"],
      now,
    };
    const proof = await proveComplianceGateHonk(
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
          country: "MX",
          expiresAtUnix: res.expiresAtUnix,
          subject,
          salt: res.salt,
          commitment: res.commitment,
          credHash:
            "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
        },
      },
      policy
    );
    assert.equal(proof.mode, "honk");
    const v = await verifyComplianceGateHonk(proof);
    assert.equal(v.ok, true, v.error);
  });
});
