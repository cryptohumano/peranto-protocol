import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const minStake = BigInt(process.env.MIN_STAKE ?? "0");
  const unbondDelay = BigInt(process.env.UNBOND_DELAY ?? String(7 * 24 * 60 * 60));
  const anchorFee = BigInt(process.env.ANCHOR_FEE ?? "0");
  const treasury = process.env.TREASURY ?? deployer.address;

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Chain ID: ${network.chainId}`);

  const DID = await ethers.getContractFactory("DIDRegistry");
  const did = await DID.deploy();
  await did.waitForDeployment();

  const Schema = await ethers.getContractFactory("SchemaRegistry");
  const schema = await Schema.deploy(deployer.address);
  await schema.waitForDeployment();

  const Attester = await ethers.getContractFactory("AttesterRegistry");
  const attester = await Attester.deploy(
    await schema.getAddress(),
    deployer.address,
    minStake,
    unbondDelay
  );
  await attester.waitForDeployment();

  const Cred = await ethers.getContractFactory("CredentialStatusRegistry");
  const cred = await Cred.deploy(
    await attester.getAddress(),
    deployer.address,
    treasury,
    anchorFee
  );
  await cred.waitForDeployment();

  const nameFee = BigInt(process.env.NAME_FEE ?? "0");
  const Names = await ethers.getContractFactory("NameRegistry");
  const names = await Names.deploy(deployer.address, treasury, nameFee);
  await names.waitForDeployment();

  const ecoSchemaId = ethers.id("peranto:EcoTestResult:v1");
  const ecoSchemaHash = ethers.id(
    JSON.stringify({
      $id: "peranto:EcoTestResult:v1",
      type: "object",
      required: ["sampleId", "testType", "result", "unit", "labName", "testedAt"],
    })
  );
  await (
    await schema.registerSchema(
      ecoSchemaId,
      ecoSchemaHash,
      "https://peranto.app/schemas/EcoTestResult/v1.json"
    )
  ).wait();

  const deployment = {
    network: network.name,
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    treasury,
    minStake: minStake.toString(),
    unbondDelay: unbondDelay.toString(),
    anchorFee: anchorFee.toString(),
    nameFee: nameFee.toString(),
    contracts: {
      DIDRegistry: await did.getAddress(),
      SchemaRegistry: await schema.getAddress(),
      AttesterRegistry: await attester.getAddress(),
      CredentialStatusRegistry: await cred.getAddress(),
      NameRegistry: await names.getAddress(),
    },
    schemas: {
      "peranto:EcoTestResult:v1": ecoSchemaId,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.chainId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment, null, 2));
  console.log(`Wrote ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
