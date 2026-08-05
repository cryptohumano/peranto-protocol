import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createIdentity,
  DELEGATE_TYPE_SVC,
  formatDid,
  parseDid,
  resolveDidDocument,
} from "./did";
import {
  issueEcoTestCredential,
  issueJwtCredential,
  verifyEcoTestJwt,
} from "./vc";
import {
  derivePurposeKeys,
  ETH_PATH_ASSERTION,
  ETH_PATH_AUTHENTICATION,
  ETH_PATH_CONTROLLER,
  KEY_AGREEMENT_URI_SUFFIX,
} from "./wallet";

test("create and parse did:peranto", () => {
  const id = createIdentity("hardhat");
  assert.match(id.did, /^did:peranto:hardhat:0x/);
  const parsed = parseDid(id.did);
  assert.equal(parsed.address.toLowerCase(), id.address.toLowerCase());
});

test("resolveDidDocument projects svc delegate to capabilityInvocation", () => {
  const id = createIdentity("hardhat");
  const delegate = privateKeyToAccount(generatePrivateKey()).address;
  const doc = resolveDidDocument(
    id.did,
    false,
    [
      {
        id: `${id.did}#service-Website.blog`,
        type: "Website",
        serviceEndpoint: "https://blog.example",
        attrKey: "Website.blog",
      },
    ],
    [
      {
        delegateType: DELEGATE_TYPE_SVC,
        address: delegate,
        validTo: Math.floor(Date.now() / 1000) + 3600,
      },
    ]
  );
  assert.equal(doc.service?.length, 1);
  assert.ok(doc.capabilityInvocation?.length);
  assert.ok(doc.verificationMethod.length >= 2);
});

test("derivePurposeKeys stable hard paths", async () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const keys = await derivePurposeKeys(mnemonic, "hardhat");
  assert.equal(keys.controller.path, ETH_PATH_CONTROLLER);
  assert.equal(keys.authentication.path, ETH_PATH_AUTHENTICATION);
  assert.equal(keys.assertion.path, ETH_PATH_ASSERTION);
  assert.equal(keys.keyAgreement.uriSuffix, KEY_AGREEMENT_URI_SUFFIX);
  assert.equal(
    keys.controller.address.toLowerCase(),
    "0x9858effd232b4033e47d90003d41ec34ecaeda94"
  );
  assert.equal(
    keys.authentication.address.toLowerCase(),
    "0x6fac4d18c912343bf86fa7049364dd4e424ab9c0"
  );
  assert.equal(
    keys.assertion.address.toLowerCase(),
    "0xb6716976a3ebe8d39aceb04372f22ff8e6802d7a"
  );
  assert.equal(
    keys.keyAgreement.x25519PublicKey.toLowerCase(),
    "0xea3ce51f63b05228f16529dd665066b33f54a820426dab0aa49c0f429a7f1c10"
  );
  assert.equal(keys.keyAgreement.publicKeyJwk.crv, "X25519");
});

test("resolveDidDocument projects purpose VMs", () => {
  const id = createIdentity("hardhat");
  const auth = privateKeyToAccount(generatePrivateKey()).address;
  const assertAddr = privateKeyToAccount(generatePrivateKey()).address;
  const doc = resolveDidDocument(id.did, false, undefined, undefined, [
    {
      relationship: "authentication",
      id: `${id.did}#key-authentication`,
      type: "EcdsaSecp256k1RecoveryMethod2020",
      blockchainAccountId: `eip155:31337:${auth}`,
    },
    {
      relationship: "assertionMethod",
      id: `${id.did}#key-assertion`,
      type: "EcdsaSecp256k1RecoveryMethod2020",
      blockchainAccountId: `eip155:31337:${assertAddr}`,
    },
    {
      relationship: "keyAgreement",
      id: `${id.did}#key-agreement`,
      type: "X25519KeyAgreementKey2020",
      publicKeyJwk: { kty: "OKP", crv: "X25519", x: "dGVzdA" },
    },
  ]);
  assert.ok(doc.authentication.includes(`${id.did}#controller`));
  assert.ok(doc.authentication.includes(`${id.did}#key-authentication`));
  assert.ok(doc.assertionMethod.includes(`${id.did}#key-assertion`));
  assert.ok(!doc.assertionMethod.includes(`${id.did}#controller`));
  assert.ok(doc.keyAgreement?.includes(`${id.did}#key-agreement`));
});

test("issue JWT-VC with assertion purpose key", async () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const keys = await derivePurposeKeys(mnemonic, "hardhat");
  const subject = privateKeyToAccount(generatePrivateKey()).address;
  const issued = await issueJwtCredential({
    issuerPrivateKey: keys.assertion.privateKey,
    issuerDidAddress: keys.controller.address,
    kid: `did:peranto:hardhat:${keys.controller.address}#key-assertion`,
    network: "hardhat",
    subjectAddress: subject,
    claims: { sampleId: "S-assert", result: "ok" },
    schemaKey: "peranto:EcoTestResult:v1",
    credentialType: "EcoTestResult",
  });
  assert.equal(
    issued.issuerDid.toLowerCase(),
    formatDid("hardhat", keys.controller.address).toLowerCase()
  );
  const failCtrl = await verifyEcoTestJwt(issued.jwt);
  assert.equal(failCtrl.valid, false);
  const ok = await verifyEcoTestJwt(issued.jwt, undefined, [
    keys.assertion.address,
  ]);
  assert.equal(ok.valid, true, ok.error);
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
