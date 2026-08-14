import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { formatDid, resolveDidDocument } from "./did";
import {
  buildDidConfiguration,
  createDidConfigurationForOrigin,
  issueDomainLinkageCredential,
  normalizeOrigin,
  originsMatch,
  verifyDomainLinkage,
  verifyDomainLinkageJwt,
} from "./domain-linkage";
import { derivePurposeKeys } from "./wallet";

test("normalizeOrigin strips path and lowercases host", () => {
  assert.equal(
    normalizeOrigin("https://Example.COM/foo"),
    "https://example.com"
  );
  assert.equal(normalizeOrigin("http://localhost:3000/x"), "http://localhost:3000");
  assert.equal(normalizeOrigin("not a url"), null);
});

test("originsMatch requires https for non-localhost", () => {
  assert.equal(
    originsMatch("http://evil.com", "http://evil.com"),
    false
  );
  assert.equal(
    originsMatch("http://evil.com", "http://evil.com", { allowHttp: true }),
    true
  );
  assert.equal(
    originsMatch("https://app.example", "https://app.example/"),
    true
  );
  assert.equal(
    originsMatch("http://localhost:5173", "http://localhost:5173"),
    true
  );
});

test("issue + verify DomainLinkage against matching origin", async () => {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const origin = "https://compliance.example";

  const issued = await issueDomainLinkageCredential({
    issuerPrivateKey: key,
    network: "hardhat",
    origin,
  });
  assert.equal(issued.origin, origin);
  assert.equal(
    issued.issuerDid.toLowerCase(),
    formatDid("hardhat", account.address).toLowerCase()
  );
  assert.equal(issued.subjectDid.toLowerCase(), issued.issuerDid.toLowerCase());

  const ok = await verifyDomainLinkageJwt({
    jwt: issued.jwt,
    pageOrigin: origin,
  });
  assert.equal(ok.ok, true, ok.error);

  const bad = await verifyDomainLinkageJwt({
    jwt: issued.jwt,
    pageOrigin: "https://phish.example",
  });
  assert.equal(bad.ok, false);
});

test("verifyDomainLinkage with did-configuration.json envelope", async () => {
  const { issued, didConfiguration } = await createDidConfigurationForOrigin({
    issuerPrivateKey: generatePrivateKey(),
    network: "hardhat",
    origin: "https://lab.example",
    expirationDate: "2031-01-01T00:00:00.000Z",
  });

  const result = await verifyDomainLinkage("https://lab.example", {
    didConfiguration,
    allowHttp: false,
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.issuerDid?.toLowerCase(), issued.issuerDid.toLowerCase());

  const expired = buildDidConfiguration([
    {
      jwt: issued.jwt,
      issuerDid: issued.issuerDid,
      origin: issued.origin,
      expirationDate: "2020-01-01T00:00:00.000Z",
    },
  ]);
  const failExp = await verifyDomainLinkage("https://lab.example", {
    didConfiguration: expired,
  });
  assert.equal(failExp.ok, false);
  assert.match(failExp.error ?? "", /expired/i);
});

test("DomainLinkage signed with assertion purpose key", async () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const keys = await derivePurposeKeys(mnemonic, "hardhat");
  const origin = "https://attester.example";
  const issued = await issueDomainLinkageCredential({
    issuerPrivateKey: keys.assertion.privateKey,
    issuerDidAddress: keys.controller.address,
    kid: `${formatDid("hardhat", keys.controller.address)}#key-assertion`,
    network: "hardhat",
    origin,
  });

  const doc = resolveDidDocument(
    formatDid("hardhat", keys.controller.address),
    false,
    [
      {
        id: `${formatDid("hardhat", keys.controller.address)}#service-LinkedDomain`,
        type: "LinkedDomains",
        serviceEndpoint: origin,
        attrKey: "LinkedDomain",
      },
    ],
    undefined,
    [
      {
        relationship: "assertionMethod",
        id: `${formatDid("hardhat", keys.controller.address)}#key-assertion`,
        type: "EcdsaSecp256k1RecoveryMethod2020",
        blockchainAccountId: `eip155:31337:${keys.assertion.address}`,
      },
    ]
  );

  const config = buildDidConfiguration([
    {
      jwt: issued.jwt,
      issuerDid: issued.issuerDid,
      origin,
    },
  ]);

  const result = await verifyDomainLinkage(origin, {
    didConfiguration: config,
    resolveDid: async () => doc,
    expectedDid: formatDid("hardhat", keys.controller.address),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.linkedDomainsMismatch, false);
});

test("reject expectedDid mismatch", async () => {
  const key = generatePrivateKey();
  const { didConfiguration } = await createDidConfigurationForOrigin({
    issuerPrivateKey: key,
    network: "hardhat",
    origin: "https://a.example",
  });
  const other = privateKeyToAccount(generatePrivateKey()).address;
  const result = await verifyDomainLinkage("https://a.example", {
    didConfiguration,
    expectedDid: formatDid("hardhat", other),
  });
  assert.equal(result.ok, false);
});
