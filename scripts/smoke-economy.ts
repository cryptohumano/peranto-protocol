/**
 * Smoke end-to-end on Paseo (or PERANTO_NETWORK): name, attester, Member VC, tip + scores.
 * Uses PRIVATE_KEY from .env (same as Hardhat deploy).
 *
 *   npm run smoke:paseo
 *
 * Requires: deployments/420420417.json and PAS on the deployer address.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  PerantoClient,
  formatDid,
  loadDeployment,
  type PerantoNetwork,
} from "@peranto/sdk";
import { parseEther, type Address, type Hex } from "viem";

const PASEO_CHAIN_ID = 420420417;

function normalizeKey(raw: string): Hex {
  const k = raw.trim();
  if (!k) throw new Error("PRIVATE_KEY vacío en .env");
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function main() {
  const network = (process.env.PERANTO_NETWORK ?? "paseo") as PerantoNetwork;
  const rpc =
    process.env.PERANTO_RPC_URL ??
    process.env.PASEO_RPC_URL ??
    "https://eth-rpc-testnet.polkadot.io/";
  const pk = normalizeKey(process.env.PRIVATE_KEY ?? process.env.PERANTO_KEY ?? "");

  const deployPath = path.resolve(
    __dirname,
    "..",
    "deployments",
    `${PASEO_CHAIN_ID}.json`
  );
  if (!fs.existsSync(deployPath)) {
    throw new Error(
      `Falta ${deployPath}. Corre npm run deploy:paseo:sync primero.`
    );
  }

  const addresses = loadDeployment(PASEO_CHAIN_ID);
  const client = new PerantoClient({
    network,
    addresses,
    rpcUrl: rpc,
    privateKey: pk,
  });
  const me = client.accountAddress!;
  const did = formatDid(network, me);

  const summary: Record<string, unknown> = {
    network,
    rpc,
    address: me,
    did,
    steps: [] as Array<Record<string, unknown>>,
  };
  const steps = summary.steps as Array<Record<string, unknown>>;

  const bal = await client.publicClient.getBalance({ address: me });
  steps.push({ step: "balance", wei: bal.toString(), pas: Number(bal) / 1e18 });
  if (bal === 0n) {
    throw new Error(
      `Address ${me} sin PAS. Fondea en https://faucet.polkadot.io/ (Hub TestNet).`
    );
  }

  // 1) Name — unique label
  const label = `smoke${Date.now().toString(36).slice(-8)}`;
  try {
    const tx = await client.registerName(label);
    steps.push({ step: "name.register", label, ok: true, tx });
  } catch (e) {
    steps.push({
      step: "name.register",
      label,
      ok: false,
      error: errMsg(e),
      note: "puede fallar si fee/saldo o nombre ocupado — se continúa",
    });
  }

  // 2) Attester for Member
  const schemaKey = "peranto:Member:v1";
  try {
    const authorized = await client.isAuthorized(me, schemaKey);
    if (!authorized) {
      const join = await client.stakeAndJoin(schemaKey);
      steps.push({
        step: "attester.stakeAndJoin",
        schemaKey,
        ok: true,
        schemaId: join.schemaId,
        txHash: join.txHash,
        stake: join.stake.toString(),
      });
    } else {
      steps.push({ step: "attester.stakeAndJoin", schemaKey, ok: true, skipped: true });
    }
  } catch (e) {
    steps.push({
      step: "attester.stakeAndJoin",
      schemaKey,
      ok: false,
      error: errMsg(e),
    });
    throw e;
  }

  // 3) Issue + anchor Member (self)
  try {
    const issued = await client.issueAndAnchorClaims(
      me,
      {
        fullName: "Smoke Tester",
        status: "activo",
        enrolledAt: new Date().toISOString(),
        channel: "smoke",
      },
      schemaKey,
      "Member"
    );
    steps.push({
      step: "vc.issueAndAnchor",
      schemaKey,
      ok: true,
      credHash: issued.credHash,
      anchorTx: issued.anchorTx,
      subjectDid: issued.subjectDid,
    });
  } catch (e) {
    steps.push({ step: "vc.issueAndAnchor", ok: false, error: errMsg(e) });
    throw e;
  }

  // 4) Tip a known node + scores
  let node: Address | null =
    (addresses.PerantoNode as Address | null | undefined) ?? null;
  const labNode =
    (addresses.EcosystemLabNode as Address | null | undefined) ?? null;
  if (!node || node === "0x0000000000000000000000000000000000000000") {
    const list = await client.listNodes();
    node = (list[0] as Address | undefined) ?? null;
  }
  const tipTarget = labNode ?? node;
  if (!tipTarget) {
    steps.push({
      step: "disco.tip",
      ok: false,
      error: "No hay nodos en el deployment — corre seed:node o createNode",
    });
  } else {
    try {
      const tipTx = await client.tip(tipTarget, tipTarget, parseEther("0.01"));
      const scores = await client.scores(tipTarget, me);
      steps.push({
        step: "disco.tip",
        ok: true,
        node: tipTarget,
        perantoNode: node,
        ecosystemLabNode: labNode,
        tipTx,
        tipValue: "0.01 PAS",
        scores: {
          love: scores.love.toString(),
          care: scores.care.toString(),
          period: scores.currentPeriod.toString(),
        },
      });
    } catch (e) {
      steps.push({
        step: "disco.tip",
        ok: false,
        node,
        error: errMsg(e),
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  const failed = steps.filter((s) => s.ok === false && s.step !== "name.register");
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
