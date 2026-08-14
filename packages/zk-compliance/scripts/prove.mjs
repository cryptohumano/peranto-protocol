#!/usr/bin/env node
/** Demo UltraHonk prove+verify against a fixture witness. */
import { createRequire } from "node:module";
import { proveComplianceGateHonk, verifyComplianceGateHonk } from "../src/honk.ts";

const require = createRequire(import.meta.url);
const {
  buildLivenessCommitment,
  buildResidenceCommitment,
} = require("@peranto/sdk");

const subject = "0x1234567890123456789012345678901234567890";
const now = Math.floor(Date.now() / 1000);
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
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
    residence: {
      country: "MX",
      expiresAtUnix: res.expiresAtUnix,
      subject,
      salt: res.salt,
      commitment: res.commitment,
      credHash:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
    },
  },
  policy
);

const verified = await verifyComplianceGateHonk(proof);
console.log(
  JSON.stringify(
    {
      mode: proof.mode,
      verified: verified.ok,
      error: verified.error,
      publicSignals: proof.publicSignals,
    },
    null,
    2
  )
);
if (!verified.ok || proof.mode !== "honk") process.exit(1);
