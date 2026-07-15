import { expect } from "chai";
import { ethers } from "hardhat";

/** Right-pad UTF-8 name to bytes32 (ERC-1056 style). */
function attrName(name: string): string {
  return ethers.encodeBytes32String(name);
}

describe("DID services (attributes)", function () {
  it("DIDRegistry setAttribute stores did/svc payloads", async function () {
    const [alice] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("DIDRegistry");
    const registry = await Reg.deploy();

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

    const filter = registry.filters.DIDAttributeChanged(alice.address);
    const logs = await registry.queryFilter(filter);
    expect(logs.length).to.equal(1);
    expect(logs[0]!.args.name).to.equal(name);
    const decoded = JSON.parse(ethers.toUtf8String(logs[0]!.args.value));
    expect(decoded.serviceEndpoint).to.equal("https://aura.example/inbox");
  });

  it("validity 0 expires the attribute immediately", async function () {
    const [alice] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("DIDRegistry");
    const registry = await Reg.deploy();
    const name = attrName("did/svc/Web");

    await registry.connect(alice).setAttribute(alice.address, name, "0x01", 0n);
    const logs = await registry.queryFilter(
      registry.filters.DIDAttributeChanged(alice.address)
    );
    const validTo = logs[0]!.args.validTo;
    const block = await ethers.provider.getBlock("latest");
    expect(validTo).to.be.lte(BigInt(block!.timestamp));
  });
});
