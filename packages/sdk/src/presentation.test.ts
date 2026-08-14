import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { formatDid } from "./did";
import { issueJwtCredential } from "./vc";
import {
  createClaimsPresentation,
  createCredentialPresentation,
  verifyPresentation,
} from "./presentation";

describe("presentation", () => {
  it("verifies full credential presentation", async () => {
    const issuerKey = generatePrivateKey();
    const holderKey = generatePrivateKey();
    const holder = privateKeyToAccount(holderKey);
    const network = "paseo" as const;
    const issued = await issueJwtCredential({
      issuerPrivateKey: issuerKey,
      network,
      subjectAddress: holder.address,
      schemaKey: "peranto:LivenessCheck:v1",
      credentialType: "LivenessCheck",
      claims: { provider: "test", livenessScore: 0.9 },
    });
    const challenge = "chal-1";
    const pres = await createCredentialPresentation({
      holderPrivateKey: holderKey,
      holderDid: formatDid(network, holder.address),
      challenge,
      credential: {
        jwt: issued.jwt,
        credHash: issued.credHash,
        schemaKey: issued.schemaKey,
        issuerDid: issued.issuerDid,
        subjectDid: issued.subjectDid,
      },
    });
    const v = await verifyPresentation(pres, { expectedChallenge: challenge });
    assert.equal(v.ok, true);
    assert.equal(v.mode, "credential");
    assert.equal(v.jwtValid, true);
    assert.equal(v.claims?.livenessScore, 0.9);
  });

  it("verifies selective claims without JWT", async () => {
    const issuerKey = generatePrivateKey();
    const holderKey = generatePrivateKey();
    const holder = privateKeyToAccount(holderKey);
    const network = "paseo" as const;
    const issued = await issueJwtCredential({
      issuerPrivateKey: issuerKey,
      network,
      subjectAddress: holder.address,
      schemaKey: "peranto:ProofOfResidence:v1",
      credentialType: "ProofOfResidence",
      claims: { country: "MX", region: "CDMX", docType: "utility" },
    });
    const challenge = "chal-2";
    const pres = await createClaimsPresentation({
      holderPrivateKey: holderKey,
      holderDid: formatDid(network, holder.address),
      challenge,
      jwt: issued.jwt,
      credHash: issued.credHash,
      schemaKey: issued.schemaKey,
      issuerDid: issued.issuerDid,
      subjectDid: issued.subjectDid,
      disclose: ["country"],
    });
    assert.equal("jwt" in (pres as object), false);
    assert.deepEqual(pres.disclosedClaims, { country: "MX" });
    const v = await verifyPresentation(pres, { expectedChallenge: challenge });
    assert.equal(v.ok, true);
    assert.equal(v.mode, "claims");
    assert.deepEqual(v.claims, { country: "MX" });
    assert.equal(v.jwtValid, undefined);
  });
});
