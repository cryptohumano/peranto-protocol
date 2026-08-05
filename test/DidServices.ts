import { expect } from "chai";
import { ethers } from "hardhat";

/** Left-aligned UTF-8 → bytes32 (matches @peranto/sdk attributeNameToBytes32). */
function attrName(name: string): string {
  const bytes = ethers.toUtf8Bytes(name);
  if (bytes.length === 0 || bytes.length > 32) {
    throw new Error(`bad name length ${bytes.length}`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 0);
  return ethers.hexlify(out);
}

function delegateType(t: string): string {
  return attrName(t);
}

describe("DIDRegistry v0.2 (storage + delegates)", function () {
  async function deploy() {
    const [alice, bob, carol] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("DIDRegistry");
    const registry = await Reg.deploy();
    return { registry, alice, bob, carol };
  }

  it("stores and enumerates did/svc attributes", async function () {
    const { registry, alice } = await deploy();
    const name = attrName("did/svc/AuraInbox");
    const payload = ethers.toUtf8Bytes(
      JSON.stringify({
        type: "AuraInbox",
        serviceEndpoint: "https://aura.example/inbox",
      })
    );

    await registry
      .connect(alice)
      .setAttribute(alice.address, name, payload, 365n * 24n * 60n * 60n);

    expect(await registry.attributeCount(alice.address)).to.equal(1n);
    expect(await registry.attributeNameAt(alice.address, 0)).to.equal(name);
    const [value, validTo, active] = await registry.getAttribute(
      alice.address,
      name
    );
    expect(active).to.equal(true);
    expect(validTo).to.be.gt(0n);
    expect(ethers.toUtf8String(value)).to.include("aura.example");
  });

  it("clears storage when validity is 0", async function () {
    const { registry, alice } = await deploy();
    const name = attrName("did/svc/Web");
    await registry
      .connect(alice)
      .setAttribute(alice.address, name, "0x01", 1000n);
    expect(await registry.attributeCount(alice.address)).to.equal(1n);

    await registry.connect(alice).setAttribute(alice.address, name, "0x", 0n);
    expect(await registry.attributeCount(alice.address)).to.equal(0n);
    const [, , active] = await registry.getAttribute(alice.address, name);
    expect(active).to.equal(false);
  });

  it("svc delegate can set did/svc attrs; stranger cannot", async function () {
    const { registry, alice, bob, carol } = await deploy();
    const name = attrName("did/svc/Website.blog");
    const payload = ethers.toUtf8Bytes(
      JSON.stringify({ type: "Website", serviceEndpoint: "https://blog.example" })
    );

    await registry
      .connect(alice)
      .addDelegate(
        alice.address,
        delegateType("svc"),
        bob.address,
        365n * 24n * 60n * 60n
      );

    await registry
      .connect(bob)
      .setAttribute(alice.address, name, payload, 1000n);

    const [, , active] = await registry.getAttribute(alice.address, name);
    expect(active).to.equal(true);

    await expect(
      registry.connect(carol).setAttribute(alice.address, name, payload, 1000n)
    ).to.be.revertedWith("DIDRegistry: bad actor");
  });

  it("svc delegate cannot changeOwner", async function () {
    const { registry, alice, bob, carol } = await deploy();
    await registry
      .connect(alice)
      .addDelegate(alice.address, delegateType("svc"), bob.address, 1000n);

    await expect(
      registry.connect(bob).changeOwner(alice.address, carol.address)
    ).to.be.revertedWith("DIDRegistry: bad actor");
  });

  it("enumerates active delegates", async function () {
    const { registry, alice, bob } = await deploy();
    await registry
      .connect(alice)
      .addDelegate(
        alice.address,
        delegateType("sigAuth"),
        bob.address,
        86400n
      );
    expect(await registry.delegateCount(alice.address)).to.equal(1n);
    const [dtype, addr, validTo] = await registry.delegateAt(alice.address, 0);
    expect(dtype).to.equal(delegateType("sigAuth"));
    expect(addr).to.equal(bob.address);
    expect(validTo).to.be.gt(0n);

    await registry
      .connect(alice)
      .revokeDelegate(alice.address, delegateType("sigAuth"), bob.address);
    expect(await registry.delegateCount(alice.address)).to.equal(0n);
    expect(
      await registry.validDelegate(
        alice.address,
        delegateType("sigAuth"),
        bob.address
      )
    ).to.equal(false);
  });

  it("svc delegate cannot set did/vm purpose attrs", async function () {
    const { registry, alice, bob } = await deploy();
    const name = attrName("did/vm/authentication");
    const payload = ethers.toUtf8Bytes(
      JSON.stringify({
        id: "did:peranto:hardhat:0x1#key-authentication",
        type: "EcdsaSecp256k1RecoveryMethod2020",
        blockchainAccountId: "eip155:31337:0x2",
      })
    );

    await registry
      .connect(alice)
      .addDelegate(
        alice.address,
        delegateType("svc"),
        bob.address,
        365n * 24n * 60n * 60n
      );

    await expect(
      registry.connect(bob).setAttribute(alice.address, name, payload, 1000n)
    ).to.be.revertedWith("DIDRegistry: not service attr");

    await registry
      .connect(alice)
      .setAttribute(alice.address, name, payload, 1000n);
    const [, , active] = await registry.getAttribute(alice.address, name);
    expect(active).to.equal(true);
  });

  it("emits DIDAttributeChanged alongside storage writes", async function () {
    const { registry, alice } = await deploy();
    const name = attrName("did/svc/AuraInbox");
    await registry
      .connect(alice)
      .setAttribute(alice.address, name, "0x01", 1000n);
    const logs = await registry.queryFilter(
      registry.filters.DIDAttributeChanged(alice.address)
    );
    expect(logs.length).to.equal(1);
    expect(logs[0]!.args.name).to.equal(name);
  });
});
