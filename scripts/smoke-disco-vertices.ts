/**
 * Smoke multi-cuenta: Love / Care / Livelihood + proyección de fin de epoch.
 *
 * Usa `.peranto/smoke-accounts.json` + `PRIVATE_KEY` (gobernanza del nodo Peranto).
 *
 *   npx tsx scripts/smoke-disco-vertices.ts
 *
 * No ejecuta harvest/distribute on-chain del periodo abierto (periodBlocks ≈ 30d);
 * proyecta el canon y el reparto como si el periodo cerrara ahora.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  PerantoClient,
  loadDeployment,
  disCONodeAbi,
  protocolTreasuryAbi,
  type PerantoNetwork,
} from "@peranto/sdk";
import {
  formatEther,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PASEO_CHAIN_ID = 420420417;

type SmokeAccount = {
  id?: string;
  role?: string;
  address?: Address;
  privateKey: Hex | string;
};

function normalizeKey(raw: string): Hex {
  const k = raw.trim();
  if (!k) throw new Error("clave vacía");
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

function loadSmokeAccounts(): Record<string, { address: Address; privateKey: Hex }> {
  const p = path.resolve(__dirname, "..", ".peranto", "smoke-accounts.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Falta ${p}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const list: SmokeAccount[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.accounts)
      ? raw.accounts
      : [];
  if (!list.length) throw new Error("smoke-accounts.json sin accounts");

  const out: Record<string, { address: Address; privateKey: Hex }> = {};
  for (const a of list) {
    const role = a.id || a.role;
    if (!role) throw new Error("cuenta smoke sin id/role");
    const privateKey = normalizeKey(String(a.privateKey));
    const derived = privateKeyToAccount(privateKey).address;
    const address = (a.address as Address | undefined) ?? derived;
    if (address.toLowerCase() !== derived.toLowerCase()) {
      throw new Error(`Mismatch address/key para rol ${role}`);
    }
    out[role] = { address, privateKey };
  }
  return out;
}

function clientFor(
  network: PerantoNetwork,
  rpc: string,
  addresses: ReturnType<typeof loadDeployment>,
  privateKey: Hex
) {
  return new PerantoClient({ network, addresses, rpcUrl: rpc, privateKey });
}

function pas(wei: bigint): string {
  return `${formatEther(wei)} PAS`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function tryStep(
  steps: Array<Record<string, unknown>>,
  step: string,
  fn: () => Promise<Record<string, unknown> | void>
) {
  try {
    const extra = (await fn()) ?? {};
    steps.push({ step, ok: true, ...extra });
  } catch (e) {
    steps.push({ step, ok: false, error: errMsg(e) });
    throw e;
  }
}

async function main() {
  const network = (process.env.PERANTO_NETWORK ?? "paseo") as PerantoNetwork;
  const rpc =
    process.env.PERANTO_RPC_URL ??
    process.env.PASEO_RPC_URL ??
    "https://eth-rpc-testnet.polkadot.io/";
  const govPk = normalizeKey(
    process.env.PRIVATE_KEY ?? process.env.PERANTO_KEY ?? ""
  );
  const addresses = loadDeployment(PASEO_CHAIN_ID);
  const smoke = loadSmokeAccounts();

  const need = [
    "attester-lab",
    "member-alice",
    "member-bob",
    "tipper-carol",
    "contributor-dave",
    "governance-erin",
  ] as const;
  for (const r of need) {
    if (!smoke[r]) throw new Error(`Falta rol smoke: ${r}`);
  }

  const node = addresses.PerantoNode as Address | null;
  if (!node) throw new Error("PerantoNode ausente en deployment");

  const gov = clientFor(network, rpc, addresses, govPk);
  const lab = clientFor(network, rpc, addresses, smoke["attester-lab"].privateKey);
  const alice = smoke["member-alice"];
  const bob = smoke["member-bob"];
  const carol = clientFor(network, rpc, addresses, smoke["tipper-carol"].privateKey);
  const dave = clientFor(network, rpc, addresses, smoke["contributor-dave"].privateKey);
  const bobClient = clientFor(network, rpc, addresses, bob.privateKey);

  const read = gov; // any client for reads
  const steps: Array<Record<string, unknown>> = [];
  const summary: Record<string, unknown> = {
    network,
    rpc,
    node,
    roles: Object.fromEntries(
      need.map((r) => [r, smoke[r].address])
    ),
    steps,
  };

  // --- Snapshot before ---
  const beforeBalances = {
    node: await read.publicClient.getBalance({ address: node }),
    treasury: await read.publicClient.getBalance({
      address: addresses.ProtocolTreasury,
    }),
    alice: await read.publicClient.getBalance({ address: alice.address }),
    bob: await read.publicClient.getBalance({ address: bob.address }),
    carol: await read.publicClient.getBalance({
      address: smoke["tipper-carol"].address,
    }),
    dave: await read.publicClient.getBalance({
      address: smoke["contributor-dave"].address,
    }),
  };
  steps.push({
    step: "snapshot.before",
    ok: true,
    balances: Object.fromEntries(
      Object.entries(beforeBalances).map(([k, v]) => [k, pas(v)])
    ),
  });

  // 1) Gobernanza: addMember Alice + Bob (tips requieren isMember)
  for (const [role, addr] of [
    ["member-alice", alice.address],
    ["member-bob", bob.address],
  ] as const) {
    const already = await read.publicClient.readContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "isMember",
      args: [addr],
    });
    if (already) {
      steps.push({ step: `disco.addMember.${role}`, ok: true, skipped: true });
      continue;
    }
    await tryStep(steps, `disco.addMember.${role}`, async () => {
      const tx = await gov.addMember(node, addr);
      return { tx, account: addr };
    });
  }

  // 2) Attester + Member VC (Alice) + recordAnchor → periodo.anchors
  const schemaKey = "peranto:Member:v1";
  await tryStep(steps, "attester.stakeAndJoin", async () => {
    const authorized = await lab.isAuthorized(lab.accountAddress!, schemaKey);
    if (authorized) return { skipped: true, schemaKey };
    const join = await lab.stakeAndJoin(schemaKey);
    return {
      schemaKey,
      schemaId: join.schemaId,
      txHash: join.txHash,
    };
  });

  // Lab must be member to recordAnchor — add if needed
  {
    const labAddr = lab.accountAddress!;
    const already = await read.publicClient.readContract({
      address: node,
      abi: disCONodeAbi,
      functionName: "isMember",
      args: [labAddr],
    });
    if (!already) {
      await tryStep(steps, "disco.addMember.attester-lab", async () => {
        const tx = await gov.addMember(node, labAddr);
        return { tx, account: labAddr };
      });
    }
  }

  let memberCredHash: Hex | null = null;
  await tryStep(steps, "vc.issueAndAnchor.alice", async () => {
    const issued = await lab.issueAndAnchorClaims(
      alice.address,
      {
        fullName: "Alice Smoke",
        status: "activo",
        enrolledAt: new Date().toISOString(),
        channel: "smoke-disco",
      },
      schemaKey,
      "Member"
    );
    memberCredHash = issued.credHash;
    return {
      credHash: issued.credHash,
      anchorTx: issued.anchorTx,
      subjectDid: issued.subjectDid,
    };
  });

  if (memberCredHash) {
    await tryStep(steps, "disco.recordAnchor", async () => {
      const tx = await lab.recordNodeAnchor(node, memberCredHash!);
      return { tx, credHash: memberCredHash };
    });
  }

  // 3) Care / Love tips
  // carol → alice (Care carol, Love alice, value to alice)
  await tryStep(steps, "disco.tip.carol→alice", async () => {
    const amount = parseEther("0.5");
    const tx = await carol.tip(node, alice.address, amount);
    return { tx, amount: pas(amount) };
  });

  // bob → alice
  await tryStep(steps, "disco.tip.bob→alice", async () => {
    const amount = parseEther("0.5");
    const tx = await bobClient.tip(node, alice.address, amount);
    return { tx, amount: pas(amount) };
  });

  // carol → node (Care carol, period Love, PAS queda en tesoro)
  await tryStep(steps, "disco.tip.carol→node", async () => {
    const amount = parseEther("0.5");
    const tx = await carol.tip(node, node, amount);
    return { tx, amount: pas(amount) };
  });

  // 4) Livelihood contribute (dave ×3 de 1 PAS)
  for (let i = 1; i <= 3; i++) {
    await tryStep(steps, `disco.contribute.dave.${i}`, async () => {
      const amount = parseEther("1");
      const tx = await dave.contribute(node, amount);
      return {
        tx,
        amount: pas(amount),
        toNode: "0.8 PAS",
        toProtocol: "0.2 PAS",
      };
    });
  }

  // 5) Snapshot scores + period + proyección epoch
  const periodId = (await read.publicClient.readContract({
    address: node,
    abi: disCONodeAbi,
    functionName: "currentPeriod",
  })) as bigint;

  const periodBlocks = (await read.publicClient.readContract({
    address: node,
    abi: disCONodeAbi,
    functionName: "periodBlocks",
  })) as bigint;

  const createdPeriod = (await read.publicClient.readContract({
    address: node,
    abi: disCONodeAbi,
    functionName: "createdPeriod",
  })) as bigint;

  const reserveFloor = (await read.publicClient.readContract({
    address: node,
    abi: disCONodeAbi,
    functionName: "reserveFloor",
  })) as bigint;

  const stats = (await read.publicClient.readContract({
    address: node,
    abi: disCONodeAbi,
    functionName: "periodStats",
    args: [periodId],
  })) as readonly [bigint, bigint, bigint, bigint, boolean];

  const sustainBps = (await read.publicClient.readContract({
    address: node,
    abi: disCONodeAbi,
    functionName: "sustainBpsFor",
    args: [periodId],
  })) as bigint;

  const actors = {
    alice: alice.address,
    bob: bob.address,
    carol: smoke["tipper-carol"].address,
    dave: smoke["contributor-dave"].address,
    lab: smoke["attester-lab"].address,
  } as const;

  const vertexScores: Record<string, unknown> = {};
  for (const [role, addr] of Object.entries(actors)) {
    const [love, care, livelihood] = await Promise.all([
      read.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "lovePoints",
        args: [addr],
      }),
      read.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "carePoints",
        args: [addr],
      }),
      read.publicClient.readContract({
        address: node,
        abi: disCONodeAbi,
        functionName: "livelihoodPoints",
        args: [addr],
      }),
    ]);
    vertexScores[role] = {
      address: addr,
      love: String(love),
      care: String(care),
      livelihood: String(livelihood),
    };
  }

  const afterBalances = {
    node: await read.publicClient.getBalance({ address: node }),
    treasury: await read.publicClient.getBalance({
      address: addresses.ProtocolTreasury,
    }),
    alice: await read.publicClient.getBalance({ address: alice.address }),
    bob: await read.publicClient.getBalance({ address: bob.address }),
    carol: await read.publicClient.getBalance({
      address: smoke["tipper-carol"].address,
    }),
    dave: await read.publicClient.getBalance({
      address: smoke["contributor-dave"].address,
    }),
  };

  // Proyección: si el periodo cerrara ahora → harvest + distribute (1 nodo elegible)
  const nodeBal = afterBalances.node;
  const base =
    nodeBal > reserveFloor ? nodeBal - reserveFloor : 0n;
  const projectedHarvest = (base * sustainBps) / 10000n;
  const treasuryAfterHarvest = afterBalances.treasury + projectedHarvest;
  const nodeAfterHarvest = nodeBal - projectedHarvest;

  const periodLove = stats[0];
  const periodCare = stats[1];
  const periodAnchors = stats[2];
  const periodLinks = stats[3];
  // cCare=5, cLove=3, cAnchors=1 (ProtocolTreasury defaults)
  const cCare = 5n;
  const cLove = 3n;
  const cAnchors = 1n;
  const weight = cCare * periodCare + cLove * periodLove + cAnchors * periodAnchors;
  // Con un solo nodo elegible: equal 50% + weight 50% = 100% del commons
  const equalBps = 5000n;
  const equalPool = (treasuryAfterHarvest * equalBps) / 10000n;
  const weightPool = treasuryAfterHarvest - equalPool;
  const projectedDistributeToNode = equalPool + weightPool; // nEligible=1

  const blockNumber = await read.publicClient.getBlockNumber();
  const blocksIntoPeriod = periodBlocks > 0n ? blockNumber % periodBlocks : 0n;
  const blocksLeft = periodBlocks > blocksIntoPeriod ? periodBlocks - blocksIntoPeriod : 0n;

  const epochProjection = {
    note:
      "harvest requiere periodId < currentPeriod; aquí se simula el cierre del periodo abierto",
    periodId: String(periodId),
    periodBlocks: String(periodBlocks),
    blocksIntoPeriod: String(blocksIntoPeriod),
    blocksLeftApprox: String(blocksLeft),
    createdPeriod: String(createdPeriod),
    periodStats: {
      love: String(periodLove),
      care: String(periodCare),
      anchors: String(periodAnchors),
      federationLinks: String(periodLinks),
      harvested: stats[4],
    },
    sustainBps: String(sustainBps),
    sustainLabel:
      sustainBps === 100n
        ? "muy integrado (1%)"
        : sustainBps === 200n
          ? "integrado (2%)"
          : "aislado/nuevo (5%)",
    nodeBalanceNow: pas(nodeBal),
    reserveFloor: pas(reserveFloor),
    projectedHarvestCanon: pas(projectedHarvest),
    nodeAfterHarvest: pas(nodeAfterHarvest),
    treasuryNow: pas(afterBalances.treasury),
    treasuryAfterHarvest: pas(treasuryAfterHarvest),
    weight_wi: String(weight),
    weightFormula: `5*care(${periodCare}) + 3*love(${periodLove}) + 1*anchors(${periodAnchors}) = ${weight}`,
    projectedDistributeBackToNode: pas(projectedDistributeToNode),
    netNodeDeltaIfSoloEligible: pas(
      nodeAfterHarvest + projectedDistributeToNode - nodeBal
    ),
    interpretation:
      "Con 1 nodo elegible, harvest mueve canon al commons y distribute lo devuelve casi todo al mismo nodo (dust puede quedar). Love/Care del periodo bajan el canon (integrado 2% vs aislado 5%). Livelihood (contribute) no entra en w_i; solo llena tesoro nodo + 20% commons.",
  };

  steps.push({
    step: "snapshot.after",
    ok: true,
    balances: Object.fromEntries(
      Object.entries(afterBalances).map(([k, v]) => [k, pas(v)])
    ),
    delta: {
      node: pas(afterBalances.node - beforeBalances.node),
      treasury: pas(afterBalances.treasury - beforeBalances.treasury),
      alice: pas(afterBalances.alice - beforeBalances.alice),
      bob: pas(afterBalances.bob - beforeBalances.bob),
      carol: pas(afterBalances.carol - beforeBalances.carol),
      dave: pas(afterBalances.dave - beforeBalances.dave),
    },
    vertexScores,
    epochProjection,
  });

  summary.epochProjection = epochProjection;
  summary.vertexScores = vertexScores;

  console.log(JSON.stringify(summary, null, 2));

  const failed = steps.filter((s) => s.ok === false);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
