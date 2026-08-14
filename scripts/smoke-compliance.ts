/**
 * Smoke compliance gate: register (if needed) Liveness + Residence schemas,
 * join as attester, issue + anchor both VCs, verify JWT + on-chain Active.
 *
 *   npm run smoke:compliance
 *
 * Env: PERANTO_NETWORK (default paseo), PERANTO_RPC_URL, PRIVATE_KEY / PERANTO_KEY
 * Requires deployments/<chainId>.json (schemas auto-registered when missing).
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  CREDENTIAL_STATUS,
  PerantoClient,
  SCHEMA_KEYS,
  formatDid,
  loadDeployment,
  type PerantoNetwork,
} from "@peranto/sdk";
import type { Hex } from "viem";

const CHAIN_IDS: Record<string, number> = {
  hardhat: 31337,
  localhost: 31337,
  paseo: 420420417,
  base: 8453,
  baseSepolia: 84532,
  arbitrum: 42161,
  arbitrumSepolia: 421614,
};

const LIVENESS_KEY = SCHEMA_KEYS.LivenessCheck;
const RESIDENCE_KEY = SCHEMA_KEYS.ProofOfResidence;

function normalizeKey(raw: string): Hex {
  const k = raw.trim();
  if (!k) throw new Error("PRIVATE_KEY vacío en .env");
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

async function ensureSchema(
  client: PerantoClient,
  schemaKey: string,
  required: string[],
  uri: string,
  steps: Array<Record<string, unknown>>
) {
  const exists = await client.schemaExists(schemaKey);
  if (exists) {
    steps.push({
      step: "schema.register",
      schemaKey,
      ok: true,
      skipped: true,
    });
    return;
  }
  const body = JSON.stringify({
    $id: schemaKey,
    type: "object",
    required,
  });
  const res = await client.registerSchema(schemaKey, body, uri);
  steps.push({
    step: "schema.register",
    schemaKey,
    ok: true,
    schemaId: res.schemaId,
    tx: res.txHash,
  });
}

async function main() {
  const network = (process.env.PERANTO_NETWORK ?? "paseo") as PerantoNetwork;
  const chainId = CHAIN_IDS[network] ?? Number(process.env.PERANTO_CHAIN_ID);
  if (!chainId) {
    throw new Error(`Unknown network ${network}; set PERANTO_CHAIN_ID`);
  }
  const rpc =
    process.env.PERANTO_RPC_URL ??
    process.env.PASEO_RPC_URL ??
    (network === "paseo"
      ? "https://eth-rpc-testnet.polkadot.io/"
      : "http://127.0.0.1:8545");
  const pk = normalizeKey(process.env.PRIVATE_KEY ?? process.env.PERANTO_KEY ?? "");

  const deployPath = path.resolve(
    __dirname,
    "..",
    "deployments",
    `${chainId}.json`
  );
  if (!fs.existsSync(deployPath)) {
    throw new Error(
      `Falta ${deployPath}. Corre deploy para esa red primero.`
    );
  }

  const addresses = loadDeployment(chainId);
  const client = new PerantoClient({
    network,
    addresses,
    rpcUrl: rpc,
    privateKey: pk,
  });
  const me = client.accountAddress!;
  const did = formatDid(network, me);
  const steps: Array<Record<string, unknown>> = [];
  const outDir = path.resolve(process.cwd(), ".peranto");
  fs.mkdirSync(outDir, { recursive: true });

  const bal = await client.publicClient.getBalance({ address: me });
  const fee = await client.getAnchorFee();
  steps.push({
    step: "balance",
    wei: bal.toString(),
    anchorFee: fee.toString(),
  });
  if (bal === 0n) {
    throw new Error(`Address ${me} sin saldo en ${network}`);
  }

  await ensureSchema(
    client,
    LIVENESS_KEY,
    ["provider", "score", "checkedAt", "expiresAt"],
    "https://peranto.app/schemas/LivenessCheck/v1.json",
    steps
  );
  await ensureSchema(
    client,
    RESIDENCE_KEY,
    [
      "country",
      "docType",
      "issuedWithinDays",
      "checkedAt",
      "expiresAt",
      "provider",
    ],
    "https://peranto.app/schemas/ProofOfResidence/v1.json",
    steps
  );

  const joinLive = await client.ensureAttesterForSchema(LIVENESS_KEY);
  steps.push({ step: "attester.ensure.liveness", ok: true, ...joinLive });
  const joinRes = await client.ensureAttesterForSchema(RESIDENCE_KEY);
  steps.push({ step: "attester.ensure.residence", ok: true, ...joinRes });

  const now = new Date();
  const livenessExp = new Date(now.getTime() + 30 * 86400_000);
  const residenceExp = new Date(now.getTime() + 90 * 86400_000);

  const liveness = await client.issueAndAnchorClaims(
    me,
    {
      provider: "smoke-compliance",
      score: 0.99,
      checkedAt: now.toISOString(),
      expiresAt: livenessExp.toISOString(),
      subjectDid: did,
    },
    LIVENESS_KEY,
    "LivenessCheck"
  );
  const livenessFile = path.join(
    outDir,
    `vc-liveness-${liveness.credHash.slice(2, 10)}.jwt`
  );
  fs.writeFileSync(livenessFile, liveness.jwt);
  steps.push({
    step: "vc.issueAndAnchor.liveness",
    ok: true,
    credHash: liveness.credHash,
    anchorTx: liveness.anchorTx,
    jwtFile: livenessFile,
  });

  const residence = await client.issueAndAnchorClaims(
    me,
    {
      country: "CH",
      region: "ZH",
      docType: "utility",
      issuedWithinDays: 14,
      checkedAt: now.toISOString(),
      expiresAt: residenceExp.toISOString(),
      provider: "smoke-compliance",
      subjectDid: did,
    },
    RESIDENCE_KEY,
    "ProofOfResidence"
  );
  const residenceFile = path.join(
    outDir,
    `vc-residence-${residence.credHash.slice(2, 10)}.jwt`
  );
  fs.writeFileSync(residenceFile, residence.jwt);
  steps.push({
    step: "vc.issueAndAnchor.residence",
    ok: true,
    credHash: residence.credHash,
    anchorTx: residence.anchorTx,
    jwtFile: residenceFile,
  });

  const vLive = await client.verifyCredential(liveness.jwt);
  steps.push({
    step: "vc.verify.liveness",
    ok:
      vLive.jwtValid &&
      vLive.authorized &&
      vLive.onChainStatus === CREDENTIAL_STATUS.Active,
    jwtValid: vLive.jwtValid,
    authorized: vLive.authorized,
    onChainStatus: ["None", "Active", "Revoked"][vLive.onChainStatus],
    error: vLive.details.error,
  });

  const vRes = await client.verifyCredential(residence.jwt);
  steps.push({
    step: "vc.verify.residence",
    ok:
      vRes.jwtValid &&
      vRes.authorized &&
      vRes.onChainStatus === CREDENTIAL_STATUS.Active,
    jwtValid: vRes.jwtValid,
    authorized: vRes.authorized,
    onChainStatus: ["None", "Active", "Revoked"][vRes.onChainStatus],
    error: vRes.details.error,
  });

  const summary = {
    network,
    rpc,
    address: me,
    did,
    steps,
    ok: steps.every((s) => s.ok !== false),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
