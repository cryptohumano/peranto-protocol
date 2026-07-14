import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Peranto identity registries", function () {
  const SCHEMA_KEY = "peranto:EcoTestResult:v1";
  const UNBOND_DELAY = 7 * 24 * 60 * 60;

  async function schemaId(): Promise<string> {
    return ethers.id(SCHEMA_KEY);
  }

  async function deployAll(minStake = 0n, anchorFee = 0n) {
    const [gov, lab, holder, other] = await ethers.getSigners();

    const DID = await ethers.getContractFactory("DIDRegistry");
    const did = await DID.deploy();

    const Schema = await ethers.getContractFactory("SchemaRegistry");
    const schema = await Schema.deploy(gov.address);

    const Attester = await ethers.getContractFactory("AttesterRegistry");
    const attester = await Attester.deploy(
      await schema.getAddress(),
      gov.address,
      minStake,
      UNBOND_DELAY
    );

    const Cred = await ethers.getContractFactory("CredentialStatusRegistry");
    const cred = await Cred.deploy(
      await attester.getAddress(),
      gov.address,
      gov.address,
      anchorFee
    );

    const sid = await schemaId();
    const schemaHash = ethers.id("eco-test-schema-body-v1");
    await schema.registerSchema(sid, schemaHash, "ipfs://eco-test-v1");

    return { gov, lab, holder, other, did, schema, attester, cred, sid, schemaHash };
  }

  it("resolves implicit DID ownership", async function () {
    const { did, lab } = await deployAll();
    expect(await did.identityOwner(lab.address)).to.equal(lab.address);
  });

  it("registers schema once and immutably", async function () {
    const { schema, sid, schemaHash } = await deployAll();
    const s = await schema.getSchema(sid);
    expect(s.exists).to.equal(true);
    expect(s.schemaHash).to.equal(schemaHash);

    await expect(
      schema.registerSchema(sid, schemaHash, "ipfs://dup")
    ).to.be.revertedWith("SchemaRegistry: already exists");
  });

  it("lets a lab stakeAndJoin and anchor a credential", async function () {
    const minStake = ethers.parseEther("1");
    const { lab, holder, attester, cred, sid } = await deployAll(minStake);

    await attester.connect(lab).stakeAndJoin(sid, { value: minStake });
    expect(await attester.isAuthorized(lab.address, sid)).to.equal(true);

    const credHash = ethers.id("vc-1");
    await cred.connect(lab).anchor(credHash, sid, holder.address);

    const st = await cred.status(credHash);
    expect(st.st).to.equal(1n); // Active
    expect(st.attester).to.equal(lab.address);
    expect(st.subject).to.equal(holder.address);
  });

  it("rejects anchor from non-attester", async function () {
    const { other, holder, cred, sid } = await deployAll();
    const credHash = ethers.id("vc-2");
    await expect(
      cred.connect(other).anchor(credHash, sid, holder.address)
    ).to.be.revertedWith("CredentialStatus: not authorized");
  });

  it("allows governance authorizeAttester without stake", async function () {
    const minStake = ethers.parseEther("1");
    const { gov, lab, holder, attester, cred, sid } = await deployAll(minStake);

    await attester.connect(gov).authorizeAttester(lab.address, sid);
    const credHash = ethers.id("vc-gov");
    await cred.connect(lab).anchor(credHash, sid, holder.address);
    expect((await cred.status(credHash)).st).to.equal(1n);
  });

  it("revokes a credential", async function () {
    const { lab, holder, attester, cred, sid } = await deployAll();
    await attester.connect(lab).stakeAndJoin(sid, { value: 0 });
    const credHash = ethers.id("vc-rev");
    await cred.connect(lab).anchor(credHash, sid, holder.address);
    await cred.connect(lab).revoke(credHash, "sample contamination");
    expect((await cred.status(credHash)).st).to.equal(2n); // Revoked
  });

  it("blocks anchoring while unbonding and releases stake after delay", async function () {
    const minStake = ethers.parseEther("1");
    const { lab, holder, attester, cred, sid } = await deployAll(minStake);

    await attester.connect(lab).stakeAndJoin(sid, { value: minStake });
    await attester.connect(lab).startUnbond();
    expect(await attester.isAuthorized(lab.address, sid)).to.equal(false);

    await expect(
      cred.connect(lab).anchor(ethers.id("vc-unbond"), sid, holder.address)
    ).to.be.revertedWith("CredentialStatus: not authorized");

    await time.increase(UNBOND_DELAY + 1);
    const before = await ethers.provider.getBalance(lab.address);
    const tx = await attester.connect(lab).withdraw();
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(lab.address);
    expect(after + gas - before).to.equal(minStake);
  });

  it("charges anchor fee to treasury", async function () {
    const fee = ethers.parseEther("0.01");
    const { gov, lab, holder, attester, cred, sid } = await deployAll(0n, fee);
    await attester.connect(lab).stakeAndJoin(sid, { value: 0 });

    const before = await ethers.provider.getBalance(gov.address);
    await cred.connect(lab).anchor(ethers.id("vc-fee"), sid, holder.address, { value: fee });
    const after = await ethers.provider.getBalance(gov.address);
    expect(after - before).to.equal(fee);
  });
});
