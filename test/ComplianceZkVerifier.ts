import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ComplianceZkVerifier", function () {
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

    const liveSid = ethers.id("peranto:LivenessCheck:v1");
    const resSid = ethers.id("peranto:ProofOfResidence:v1");
    await schema.registerSchema(liveSid, ethers.id("l"), "ipfs://l");
    await schema.registerSchema(resSid, ethers.id("r"), "ipfs://r");
    await attester.connect(lab).stakeAndJoin(liveSid, NATIVE, 0n);
    await attester.connect(lab).stakeAndJoin(resSid, NATIVE, 0n);

    const allowlistRoot = ethers.id("allowlist-demo");
    const minScore = 9000n;
    const Gate = await ethers.getContractFactory("ComplianceZkVerifier");
    const gate = await Gate.deploy(
      await cred.getAddress(),
      gov.address,
      minScore,
      allowlistRoot
    );

    return { gov, lab, holder, cred, gate, liveSid, resSid, allowlistRoot, minScore };
  }

  it("verifyGate passes when both creds valid and commitments match (no groth16)", async function () {
    const { lab, holder, cred, gate, liveSid, resSid, allowlistRoot, minScore } =
      await deploy();
    const now = await time.latest();
    const validUntil = BigInt(now + 86400);
    const liveHash = ethers.id("live");
    const resHash = ethers.id("res");
    const liveCommit = ethers.id("live-c");
    const resCommit = ethers.id("res-c");

    await cred
      .connect(lab)
      .anchorV2(liveHash, liveSid, holder.address, validUntil, liveCommit, NATIVE, 0n);
    await cred
      .connect(lab)
      .anchorV2(resHash, resSid, holder.address, validUntil, resCommit, NATIVE, 0n);

    const nowTs = BigInt(now);
    const a: [bigint, bigint] = [0n, 0n];
    const b: [[bigint, bigint], [bigint, bigint]] = [
      [0n, 0n],
      [0n, 0n],
    ];
    const c: [bigint, bigint] = [0n, 0n];
    const inputs: [bigint, bigint, bigint, bigint, bigint] = [
      BigInt(liveCommit),
      BigInt(resCommit),
      minScore,
      BigInt(allowlistRoot),
      nowTs,
    ];

    await expect(
      gate.verifyGate(liveHash, resHash, nowTs, a, b, c, inputs)
    ).to.emit(gate, "GateVerified");
  });

  it("rejects expired liveness", async function () {
    const { lab, holder, cred, gate, liveSid, resSid, allowlistRoot, minScore } =
      await deploy();
    const now = await time.latest();
    const validUntil = BigInt(now + 10);
    const liveHash = ethers.id("live2");
    const resHash = ethers.id("res2");
    const liveCommit = ethers.id("live-c2");
    const resCommit = ethers.id("res-c2");

    await cred
      .connect(lab)
      .anchorV2(liveHash, liveSid, holder.address, validUntil, liveCommit, NATIVE, 0n);
    await cred
      .connect(lab)
      .anchorV2(
        resHash,
        resSid,
        holder.address,
        BigInt(now + 86400),
        resCommit,
        NATIVE,
        0n
      );

    await time.increaseTo(validUntil + 1n);

    const nowTs = validUntil + 1n;
    await expect(
      gate.verifyGate(
        liveHash,
        resHash,
        nowTs,
        [0n, 0n],
        [
          [0n, 0n],
          [0n, 0n],
        ],
        [0n, 0n],
        [
          BigInt(liveCommit),
          BigInt(resCommit),
          minScore,
          BigInt(allowlistRoot),
          nowTs,
        ]
      )
    ).to.be.revertedWith("ComplianceZk: live invalid");
  });
});
