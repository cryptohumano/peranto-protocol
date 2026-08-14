import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Peranto identity registries", function () {
  const SCHEMA_KEY = "peranto:EcoTestResult:v1";
  const UNBOND_DELAY = 7 * 24 * 60 * 60;
  const NATIVE = ethers.ZeroAddress;

  async function schemaId(): Promise<string> {
    return ethers.id(SCHEMA_KEY);
  }

  async function deployAll(minStake = 0n, anchorFee = 0n) {
    const [gov, lab, holder, other] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);

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
    await attester.connect(gov).setTokenRegistry(await treasury.getAddress());

    const Cred = await ethers.getContractFactory("CredentialStatusRegistry");
    const cred = await Cred.deploy(
      await attester.getAddress(),
      gov.address,
      await treasury.getAddress(),
      anchorFee
    );

    const sid = await schemaId();
    const schemaHash = ethers.id("eco-test-schema-body-v1");
    await schema.registerSchema(sid, schemaHash, "ipfs://eco-test-v1");

    return { gov, lab, holder, other, did, schema, attester, cred, treasury, sid, schemaHash };
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

    await attester.connect(lab).stakeAndJoin(sid, NATIVE, minStake, { value: minStake });
    expect(await attester.isAuthorized(lab.address, sid)).to.equal(true);

    const credHash = ethers.id("vc-1");
    await cred.connect(lab).anchor(credHash, sid, holder.address, NATIVE, 0n);

    const st = await cred.status(credHash);
    expect(st.st).to.equal(1n); // Active
    expect(st.attester).to.equal(lab.address);
    expect(st.subject).to.equal(holder.address);
  });

  it("rejects anchor from non-attester", async function () {
    const { other, holder, cred, sid } = await deployAll();
    const credHash = ethers.id("vc-2");
    await expect(
      cred.connect(other).anchor(credHash, sid, holder.address, NATIVE, 0n)
    ).to.be.revertedWith("CredentialStatus: not authorized");
  });

  it("allows governance authorizeAttester without stake", async function () {
    const minStake = ethers.parseEther("1");
    const { gov, lab, holder, attester, cred, sid } = await deployAll(minStake);

    await attester.connect(gov).authorizeAttester(lab.address, sid);
    const credHash = ethers.id("vc-gov");
    await cred.connect(lab).anchor(credHash, sid, holder.address, NATIVE, 0n);
    expect((await cred.status(credHash)).st).to.equal(1n);
  });

  it("revokes a credential", async function () {
    const { lab, holder, attester, cred, sid } = await deployAll();
    await attester.connect(lab).stakeAndJoin(sid, NATIVE, 0n);
    const credHash = ethers.id("vc-rev");
    await cred.connect(lab).anchor(credHash, sid, holder.address, NATIVE, 0n);
    await cred.connect(lab).revoke(credHash, "sample contamination");
    expect((await cred.status(credHash)).st).to.equal(2n); // Revoked
  });

  it("blocks anchoring while unbonding and releases stake after delay", async function () {
    const minStake = ethers.parseEther("1");
    const { lab, holder, attester, cred, sid } = await deployAll(minStake);

    await attester.connect(lab).stakeAndJoin(sid, NATIVE, minStake, { value: minStake });
    await attester.connect(lab).startUnbond();
    expect(await attester.isAuthorized(lab.address, sid)).to.equal(false);

    await expect(
      cred.connect(lab).anchor(ethers.id("vc-unbond"), sid, holder.address, NATIVE, 0n)
    ).to.be.revertedWith("CredentialStatus: not authorized");

    await time.increase(UNBOND_DELAY + 1);
    const before = await ethers.provider.getBalance(lab.address);
    const tx = await attester.connect(lab).withdraw(NATIVE);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(lab.address);
    expect(after + gas - before).to.equal(minStake);
  });

  it("charges anchor fee to treasury", async function () {
    const fee = ethers.parseEther("0.01");
    const { lab, holder, attester, cred, treasury, sid } = await deployAll(0n, fee);
    await attester.connect(lab).stakeAndJoin(sid, NATIVE, 0n);

    const before = await ethers.provider.getBalance(await treasury.getAddress());
    await cred
      .connect(lab)
      .anchor(ethers.id("vc-fee"), sid, holder.address, NATIVE, fee, { value: fee });
    const after = await ethers.provider.getBalance(await treasury.getAddress());
    expect(after - before).to.equal(fee);
  });

  it("stakeAndJoin and anchor with ERC-20", async function () {
    const { gov, lab, holder, attester, cred, treasury, sid } = await deployAll();
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("USDC", "USDC", 6);
    const token = await usdc.getAddress();
    await treasury.connect(gov).setTokenAllowed(token, true);
    const minStake = 10n * 10n ** 6n;
    await attester.connect(gov)["setMinStake(address,uint256)"](token, minStake);
    await usdc.mint(lab.address, minStake);
    await usdc.connect(lab).approve(await attester.getAddress(), minStake);
    await attester.connect(lab).stakeAndJoin(sid, token, minStake);
    expect(await attester.isAuthorized(lab.address, sid)).to.equal(true);

    const fee = 1n * 10n ** 6n;
    await cred.connect(gov)["setAnchorFee(address,uint256)"](token, fee);
    await usdc.mint(lab.address, fee);
    await usdc.connect(lab).approve(await cred.getAddress(), fee);
    await cred.connect(lab).anchor(ethers.id("vc-usdc"), sid, holder.address, token, fee);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(fee);
  });
});
