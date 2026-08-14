import assert from "node:assert/strict";
import test from "node:test";
import { schemaIdFromKey } from "./did";
import {
  CREDENTIAL_STATUS,
  SCHEMA_KEYS,
  type LivenessCheckClaims,
  type ProofOfResidenceClaims,
} from "./schemas";

test("SCHEMA_KEYS are stable keccak ids", () => {
  assert.equal(SCHEMA_KEYS.LivenessCheck, "peranto:LivenessCheck:v1");
  assert.equal(SCHEMA_KEYS.ProofOfResidence, "peranto:ProofOfResidence:v1");
  assert.equal(SCHEMA_KEYS.DomainLinkage, "peranto:DomainLinkage:v1");
  assert.match(schemaIdFromKey(SCHEMA_KEYS.LivenessCheck), /^0x[0-9a-f]{64}$/i);
  assert.notEqual(
    schemaIdFromKey(SCHEMA_KEYS.LivenessCheck),
    schemaIdFromKey(SCHEMA_KEYS.ProofOfResidence)
  );
});

test("CREDENTIAL_STATUS matches on-chain enum", () => {
  assert.equal(CREDENTIAL_STATUS.None, 0);
  assert.equal(CREDENTIAL_STATUS.Active, 1);
  assert.equal(CREDENTIAL_STATUS.Revoked, 2);
});

test("compliance claim shapes are assignable", () => {
  const live: LivenessCheckClaims = {
    provider: "didit",
    score: 0.97,
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  };
  const res: ProofOfResidenceClaims = {
    country: "MX",
    docType: "utility",
    issuedWithinDays: 12,
    checkedAt: live.checkedAt,
    expiresAt: live.expiresAt,
    provider: "didit",
    region: "JAL",
  };
  assert.equal(live.provider, "didit");
  assert.equal(res.country.length, 2);
});
