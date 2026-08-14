import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CredentialStatusRegistry vigencia (anchorV2)", function () {
  const SCHEMA_KEY = "peranto:LivenessCheck:v1";
  const UNBOND_DELAY = 7 * 24 * 60 * 60;
  const NATIVE = ethers.ZeroAddress;

  async function deploy() {
    const [gov, lab, holder] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);

    const Schema = await ethers.getContractFactory("SchemaRegistry");
    const schema = await Schema.deploy(gov.address);

    const Attester = await ethers.getContractFactory("AttesterRegistry");
    const attester = await Attester.deploy(
      await schema.getAddress(),
      gov.address,
      0n,
      UNBOND_DELAY
    );
    await attester.connect(gov).setTokenRegistry(await treasury.getAddress());

    const Cred = await ethers.getContractFactory("CredentialStatusRegistry");
    const cred = await Cred.deploy(
      await attester.getAddress(),
      gov.address,
      await treasury.getAddress(),
      0n
    );

    const sid = ethers.id(SCHEMA_KEY);
    await schema.registerSchema(sid, ethers.id("liveness-body"), "ipfs://liveness");
    await attester.connect(lab).stakeAndJoin(sid, NATIVE, 0n);

    return { gov, lab, holder, cred, sid };
  }

  it("anchorV2 stores validUntil + claimsCommitment; isValid until expiry", async function () {
    const { lab, holder, cred, sid } = await deploy();
    const credHash = ethers.id("live-1");
    const commitment = ethers.id("commitment-1");
    const now = await time.latest();
    const validUntil = BigInt(now + 30 * 24 * 60 * 60);

    await cred
      .connect(lab)
      .anchorV2(credHash, sid, holder.address, validUntil, commitment, NATIVE, 0n);

    expect(await cred.isValid(credHash)).to.equal(true);

    const st = await cred.statusV2(credHash);
    expect(st.st).to.equal(1n);
    expect(st.validUntil).to.equal(validUntil);
    expect(st.claimsCommitment).to.equal(commitment);
    expect(st.subject).to.equal(holder.address);

    await time.increaseTo(validUntil + 1n);
    expect(await cred.isValid(credHash)).to.equal(false);
    // status enum still Active — expiry is soft via isValid
    expect((await cred.status(credHash)).st).to.equal(1n);
  });

  it("legacy anchor has validUntil=0 and stays isValid until revoked", async function () {
    const { lab, holder, cred, sid } = await deploy();
    const credHash = ethers.id("legacy-1");
    await cred.connect(lab).anchor(credHash, sid, holder.address, NATIVE, 0n);
    expect(await cred.isValid(credHash)).to.equal(true);
    const st = await cred.statusV2(credHash);
    expect(st.validUntil).to.equal(0n);
    expect(st.claimsCommitment).to.equal(ethers.ZeroHash);

    await time.increase(365 * 24 * 60 * 60);
    expect(await cred.isValid(credHash)).to.equal(true);

    await cred.connect(lab).revoke(credHash, "revoked");
    expect(await cred.isValid(credHash)).to.equal(false);
  });

  it("rejects anchorV2 with past validUntil or empty commitment", async function () {
    const { lab, holder, cred, sid } = await deploy();
    const now = await time.latest();
    await expect(
      cred
        .connect(lab)
        .anchorV2(
          ethers.id("past"),
          sid,
          holder.address,
          BigInt(now - 1),
          ethers.id("c"),
          NATIVE,
          0n
        )
    ).to.be.revertedWith("CredentialStatus: validUntil past");

    await expect(
      cred
        .connect(lab)
        .anchorV2(
          ethers.id("empty"),
          sid,
          holder.address,
          BigInt(now + 1000),
          ethers.ZeroHash,
          NATIVE,
          0n
        )
    ).to.be.revertedWith("CredentialStatus: empty commitment");
  });

  it("revoke wins over unexpired validUntil", async function () {
    const { lab, holder, cred, sid } = await deploy();
    const credHash = ethers.id("rev-live");
    const now = await time.latest();
    await cred
      .connect(lab)
      .anchorV2(
        credHash,
        sid,
        holder.address,
        BigInt(now + 86400),
        ethers.id("c2"),
        NATIVE,
        0n
      );
    expect(await cred.isValid(credHash)).to.equal(true);
    await cred.connect(lab).revoke(credHash, "fraud");
    expect(await cred.isValid(credHash)).to.equal(false);
  });
});
