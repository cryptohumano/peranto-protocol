import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const minStake = BigInt(process.env.MIN_STAKE ?? "0");
  const unbondDelay = BigInt(process.env.UNBOND_DELAY ?? String(7 * 24 * 60 * 60));
  const anchorFee = BigInt(process.env.ANCHOR_FEE ?? "0");
  const nameFee = BigInt(process.env.NAME_FEE ?? "0");
  // ~30d @ ~6s/block on Hub TestNet; Hardhat demos can override with PERIOD_BLOCKS=10
  const periodBlocks = BigInt(process.env.PERIOD_BLOCKS ?? "432000");
  const reserveFloor = BigInt(process.env.RESERVE_FLOOR ?? "0");
  const createPerantoNode = (process.env.CREATE_PERANTO_NODE ?? "true") !== "false";
  const createEcosystemLab =
    (process.env.CREATE_ECOSYSTEM_LAB ?? "true") !== "false";

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Chain ID: ${network.chainId}`);

  // En Hub TestNet, reintentos idénticos se banean por hash; jitter de gasPrice
  // cambia el signed payload cuando hay TemporarilyBanned en el pool.
  const overrides =
    network.chainId === 420420417n
      ? {
          gasPrice: 1_000_000_000_000n + BigInt(Date.now() % 1_000_000),
        }
      : {};

  const ProtocolTreasury = await ethers.getContractFactory("ProtocolTreasury");
  const protocolTreasury = await ProtocolTreasury.deploy(deployer.address, overrides);
  await protocolTreasury.waitForDeployment();
  const treasuryAddr = await protocolTreasury.getAddress();

  const Factory = await ethers.getContractFactory("DisCOFactory");
  const factory = await Factory.deploy(
    treasuryAddr,
    deployer.address,
    periodBlocks,
    reserveFloor
  );
  await factory.waitForDeployment();
  await (await protocolTreasury.setFactory(await factory.getAddress())).wait();

  let perantoNode: string | undefined;
  let ecosystemLabNode: string | undefined;

  async function createNamedNode(name: string): Promise<string | undefined> {
    const [deployerSigner] = await ethers.getSigners();
    const before = await factory.nodeCount();
    const tx = await factory.createNode(name, overrides);
    const receipt = await tx.wait();
    let node = (await factory.nodeByCreator(deployerSigner!.address)) as string;
    if (!node || node === ethers.ZeroAddress) {
      const after = await factory.nodeCount();
      if (after > before) {
        node = (await factory.allNodes(after - 1n)) as string;
      }
    }
    if (!node || node === ethers.ZeroAddress) {
      const created = receipt!.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "NodeCreated");
      node = created?.args?.node as string;
    }
    if (!node || node === ethers.ZeroAddress) {
      console.warn(`WARN: ${name} node create tx mined but address not resolved`);
      return undefined;
    }
    console.log(`${name} node → ${node}`);
    return node;
  }

  if (createPerantoNode) {
    perantoNode = await createNamedNode("Peranto");
  }
  if (createEcosystemLab) {
    ecosystemLabNode = await createNamedNode("EcosystemLab");
  }

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
    treasuryAddr,
    anchorFee
  );
  await cred.waitForDeployment();

  const Names = await ethers.getContractFactory("NameRegistry");
  const names = await Names.deploy(deployer.address, treasuryAddr, nameFee);
  await names.waitForDeployment();

  // Compliance ZK gate (policy defaults — governance can update)
  const allowlistRoot = ethers.id("peranto:allowlist:demo");
  const Gate = await ethers.getContractFactory("ComplianceZkVerifier");
  const complianceGate = await Gate.deploy(
    await cred.getAddress(),
    deployer.address,
    9000n,
    allowlistRoot
  );
  await complianceGate.waitForDeployment();

  // Wire attester → treasury allowlist (native always allowed by default).
  await (await attester.setTokenRegistry(treasuryAddr, overrides)).wait();

  /** Comma-separated ERC-20 addresses to allow as payment tokens on this chain. */
  const paymentTokenAddrs = (process.env.PAYMENT_TOKENS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s));

  type PaymentTokenMeta = {
    address: string;
    symbol: string;
    decimals: number;
    native: boolean;
  };

  const paymentTokens: PaymentTokenMeta[] = [
    {
      address: ethers.ZeroAddress,
      symbol: network.chainId === 420420417n ? "PAS" : "ETH",
      decimals: 18,
      native: true,
    },
  ];

  for (const addr of paymentTokenAddrs) {
    await (await protocolTreasury.setTokenAllowed(addr, true, overrides)).wait();
    let symbol = "ERC20";
    let decimals = 18;
    try {
      const erc20 = await ethers.getContractAt(
        [
          "function symbol() view returns (string)",
          "function decimals() view returns (uint8)",
        ],
        addr
      );
      symbol = await erc20.symbol();
      decimals = Number(await erc20.decimals());
    } catch {
      /* keep defaults */
    }
    paymentTokens.push({ address: addr, symbol, decimals, native: false });
    console.log(`Allowed payment token → ${symbol} (${addr})`);
  }

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

  const tipSchemaId = ethers.id("peranto:TipReceipt:v1");
  const tipSchemaHash = ethers.id(
    JSON.stringify({
      $id: "peranto:TipReceipt:v1",
      type: "object",
      required: ["from", "to", "amount", "node", "tippedAt"],
    })
  );
  await (
    await schema.registerSchema(
      tipSchemaId,
      tipSchemaHash,
      "https://peranto.app/schemas/TipReceipt/v1.json"
    )
  ).wait();

  const memberSchemaId = ethers.id("peranto:Member:v1");
  const memberSchemaHash = ethers.id(
    JSON.stringify({
      $id: "peranto:Member:v1",
      type: "object",
      required: ["fullName", "status", "enrolledAt"],
    })
  );
  await (
    await schema.registerSchema(
      memberSchemaId,
      memberSchemaHash,
      "https://peranto.app/schemas/Member/v1.json"
    )
  ).wait();

  const commonsSchemaId = ethers.id("peranto:CommonsWork:v1");
  const commonsSchemaHash = ethers.id(
    JSON.stringify({
      $id: "peranto:CommonsWork:v1",
      type: "object",
      required: ["title", "workedAt"],
    })
  );
  await (
    await schema.registerSchema(
      commonsSchemaId,
      commonsSchemaHash,
      "https://peranto.app/schemas/CommonsWork/v1.json"
    )
  ).wait();

  const careSchemaId = ethers.id("peranto:CareContribution:v1");
  const careSchemaHash = ethers.id(
    JSON.stringify({
      $id: "peranto:CareContribution:v1",
      type: "object",
      required: ["kind", "contributedAt"],
    })
  );
  await (
    await schema.registerSchema(
      careSchemaId,
      careSchemaHash,
      "https://peranto.app/schemas/CareContribution/v1.json"
    )
  ).wait();

  const livenessSchemaId = ethers.id("peranto:LivenessCheck:v1");
  const livenessSchemaHash = ethers.id(
    JSON.stringify({
      $id: "peranto:LivenessCheck:v1",
      type: "object",
      required: ["provider", "score", "checkedAt", "expiresAt"],
    })
  );
  await (
    await schema.registerSchema(
      livenessSchemaId,
      livenessSchemaHash,
      "https://peranto.app/schemas/LivenessCheck/v1.json"
    )
  ).wait();

  const residenceSchemaId = ethers.id("peranto:ProofOfResidence:v1");
  const residenceSchemaHash = ethers.id(
    JSON.stringify({
      $id: "peranto:ProofOfResidence:v1",
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
  );
  await (
    await schema.registerSchema(
      residenceSchemaId,
      residenceSchemaHash,
      "https://peranto.app/schemas/ProofOfResidence/v1.json"
    )
  ).wait();

  const deployment = {
    network: network.name,
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    treasury: treasuryAddr,
    minStake: minStake.toString(),
    unbondDelay: unbondDelay.toString(),
    anchorFee: anchorFee.toString(),
    nameFee: nameFee.toString(),
    periodBlocks: periodBlocks.toString(),
    reserveFloor: reserveFloor.toString(),
    paymentTokens,
    contracts: {
      ProtocolTreasury: treasuryAddr,
      DisCOFactory: await factory.getAddress(),
      PerantoNode: perantoNode ?? null,
      EcosystemLabNode: ecosystemLabNode ?? null,
      DIDRegistry: await did.getAddress(),
      SchemaRegistry: await schema.getAddress(),
      AttesterRegistry: await attester.getAddress(),
      CredentialStatusRegistry: await cred.getAddress(),
      NameRegistry: await names.getAddress(),
      ComplianceZkVerifier: await complianceGate.getAddress(),
    },
    schemas: {
      "peranto:EcoTestResult:v1": ecoSchemaId,
      "peranto:TipReceipt:v1": tipSchemaId,
      "peranto:Member:v1": memberSchemaId,
      "peranto:CommonsWork:v1": commonsSchemaId,
      "peranto:CareContribution:v1": careSchemaId,
      "peranto:LivenessCheck:v1": livenessSchemaId,
      "peranto:ProofOfResidence:v1": residenceSchemaId,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.chainId}.json`);
  const body = JSON.stringify(deployment, null, 2);
  fs.writeFileSync(outFile, body);
  console.log(body);
  console.log(`Wrote ${outFile}`);

  // Keep portal + known path in sync for Paseo
  if (Number(network.chainId) === 420420417) {
    const webPublic = path.join(
      __dirname,
      "..",
      "packages",
      "web",
      "public",
      "deployments",
      "paseo.json"
    );
    fs.mkdirSync(path.dirname(webPublic), { recursive: true });
    fs.writeFileSync(webPublic, body);
    console.log(`Wrote ${webPublic}`);

    const alias = path.join(outDir, "paseo.json");
    fs.writeFileSync(alias, body);
    console.log(`Wrote ${alias}`);
  }

  console.log("\nNext:");
  console.log("  1. Update Aura DEFAULT_PASEO_ADDRESSES (or re-import deployment JSON in popup)");
  console.log("  2. Rebuild Aura: cd packages/extension && npm run pack");
  console.log("  3. Portal already reads /deployments/paseo.json after refresh");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
