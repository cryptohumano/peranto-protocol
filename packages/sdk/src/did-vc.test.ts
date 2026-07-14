import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createIdentity, formatDid, parseDid } from "./did";
import { issueEcoTestCredential, verifyEcoTestJwt } from "./vc";

test("create and parse did:peranto", () => {
  const id = createIdentity("hardhat");
  assert.match(id.did, /^did:peranto:hardhat:0x/);
  const parsed = parseDid(id.did);
  assert.equal(parsed.address.toLowerCase(), id.address.toLowerCase());
});

test("issue and verify EcoTest JWT-VC", async () => {
  const issuerKey = generatePrivateKey();
  const issuer = privateKeyToAccount(issuerKey);
  const subject = privateKeyToAccount(generatePrivateKey()).address;

  const issued = await issueEcoTestCredential({
    issuerPrivateKey: issuerKey,
    network: "hardhat",
    subjectAddress: subject,
    claims: {
      sampleId: "S-1",
      testType: "pH",
      result: "7.1",
      unit: "pH",
      labName: "Lab",
      testedAt: new Date().toISOString(),
    },
  });

  assert.equal(issued.issuerDid, formatDid("hardhat", issuer.address));
  const verified = await verifyEcoTestJwt(issued.jwt);
  assert.equal(verified.valid, true, verified.error);
  assert.equal(verified.issuerDid, issued.issuerDid);
});
