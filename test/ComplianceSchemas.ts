import { expect } from "chai";
import { ethers } from "hardhat";

describe("Compliance schemas (Liveness + Residence)", function () {
  const LIVENESS = "peranto:LivenessCheck:v1";
  const RESIDENCE = "peranto:ProofOfResidence:v1";
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

    const livenessId = ethers.id(LIVENESS);
    await schema.registerSchema(
      livenessId,
      ethers.id(
        JSON.stringify({
          $id: LIVENESS,
          type: "object",
          required: ["provider", "score", "checkedAt", "expiresAt"],
        })
      ),
      "https://peranto.app/schemas/LivenessCheck/v1.json"
    );

    const residenceId = ethers.id(RESIDENCE);
    await schema.registerSchema(
      residenceId,
      ethers.id(
        JSON.stringify({
          $id: RESIDENCE,
          type: "object",
          required: [
            "country",
            "docType",
            "issuedWithinDays",
            "checkedAt",
            "expiresAt",
            "provider",
          ],
        })
      ),
      "https://peranto.app/schemas/ProofOfResidence/v1.json"
    );

    return { lab, holder, schema, attester, cred, livenessId, residenceId };
  }

  it("registers both compliance schemas", async function () {
    const { schema, livenessId, residenceId } = await deploy();
    expect(await schema.schemaExists(livenessId)).to.equal(true);
    expect(await schema.schemaExists(residenceId)).to.equal(true);
  });

  it("lets attester join and anchor hashes for both schemas", async function () {
    const { lab, holder, attester, cred, livenessId, residenceId } =
      await deploy();

    await attester.connect(lab).stakeAndJoin(livenessId, NATIVE, 0n);
    await attester.connect(lab).addSchema(residenceId);
    expect(await attester.isAuthorized(lab.address, livenessId)).to.equal(true);
    expect(await attester.isAuthorized(lab.address, residenceId)).to.equal(true);

    const liveHash = ethers.id("liveness-demo-cred");
    await cred
      .connect(lab)
      .anchor(liveHash, livenessId, holder.address, NATIVE, 0n);
    const liveSt = await cred.status(liveHash);
    expect(liveSt.st).to.equal(1n);
    expect(liveSt.subject).to.equal(holder.address);

    const resHash = ethers.id("residence-demo-cred");
    await cred
      .connect(lab)
      .anchor(resHash, residenceId, holder.address, NATIVE, 0n);
    const resSt = await cred.status(resHash);
    expect(resSt.st).to.equal(1n);
    expect(resSt.subject).to.equal(holder.address);
  });
});
