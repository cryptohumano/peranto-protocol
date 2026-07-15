import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMultiKeyIdentity,
  signPayload,
  verifyPayload,
  ethAddressToAccountId32,
} from "./wallet";

describe("multi-key wallet", () => {
  it("derives evm + sr25519 + ed25519 from one mnemonic", async () => {
    const id = await createMultiKeyIdentity("hardhat");
    assert.equal(id.mnemonic.split(" ").length, 12);
    assert.match(id.evm.address, /^0x[a-fA-F0-9]{40}$/);
    assert.match(id.evm.did, /^did:peranto:hardhat:0x/);
    assert.ok(id.substrate.sr25519Address.startsWith("5"));
    assert.ok(id.substrate.ed25519Address.startsWith("5"));
    assert.equal(id.evmMappedAccountId32.length, 66);
    assert.equal(
      id.evmMappedAccountId32,
      ethAddressToAccountId32(id.evm.address)
    );
  });

  it("signs and verifies secp256k1 + sr25519", async () => {
    const id = await createMultiKeyIdentity("paseo");
    const msg = "aura-pvm-substrate-test";

    const evmSig = await signPayload({
      scheme: "secp256k1",
      message: msg,
      evmPrivateKey: id.evm.privateKey,
    });
    assert.equal(evmSig.recoveredAddress?.toLowerCase(), id.evm.address.toLowerCase());
    const evmOk = await verifyPayload({
      scheme: "secp256k1",
      message: msg,
      signature: evmSig.signature,
      addressOrPublicKey: id.evm.address,
    });
    assert.equal(evmOk.valid, true);

    const srSig = await signPayload({
      scheme: "sr25519",
      message: msg,
      mnemonic: id.mnemonic,
    });
    const srOk = await verifyPayload({
      scheme: "sr25519",
      message: msg,
      signature: srSig.signature,
      addressOrPublicKey: id.substrate.sr25519Address,
    });
    assert.equal(srOk.valid, true);

    const edSig = await signPayload({
      scheme: "ed25519",
      message: msg,
      encoding: "hex",
      mnemonic: id.mnemonic,
    });
    // hex message of utf8 — use utf8 for ed too
    void edSig;
    const edSig2 = await signPayload({
      scheme: "ed25519",
      message: msg,
      mnemonic: id.mnemonic,
    });
    const edOk = await verifyPayload({
      scheme: "ed25519",
      message: msg,
      signature: edSig2.signature,
      addressOrPublicKey: id.substrate.ed25519Address,
    });
    assert.equal(edOk.valid, true);
  });
});
