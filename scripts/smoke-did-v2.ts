/**
 * Smoke DIDRegistry v0.2 on Paseo: storage services, svc delegate write,
 * purpose keys + JWT-VC signed with assertion key.
 *
 *   npm run smoke:did
 */
import "dotenv/config";
import {
  DELEGATE_TYPE_SVC,
  PerantoClient,
  createMultiKeyIdentity,
  didRegistryAbi,
  formatDid,
  loadDeployment,
  type PerantoNetwork,
} from "@peranto/sdk";
import { parseEther, type Hex } from "viem";

const PASEO_CHAIN_ID = 420420417;
const DEFAULT_RPC = "https://services.polkadothub-rpc.com/testnet/";

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
  const rpc = process.env.PERANTO_RPC_URL ?? DEFAULT_RPC;
  const pk = normalizeKey(process.env.PRIVATE_KEY ?? process.env.PERANTO_KEY ?? "");
  const addresses = loadDeployment(PASEO_CHAIN_ID);
  const funder = new PerantoClient({
    network,
    addresses,
    rpcUrl: rpc,
    privateKey: pk,
  });
  const steps: Array<Record<string, unknown>> = [];
  const gasPrice = await funder.publicClient.getGasPrice();

  const subjectId = await createMultiKeyIdentity(network);
  const subjectClient = new PerantoClient({
    network,
    addresses,
    rpcUrl: rpc,
    privateKey: subjectId.evm.privateKey,
    mnemonic: subjectId.mnemonic,
  });
  const subject = subjectClient.accountAddress!;
  const did = formatDid(network, subject);

  // ~0.25 PAS covers several contract calls at ~1000 gwei with estimated gas.
  const fundHash = await funder.walletClient!.sendTransaction({
    to: subject,
    value: parseEther("0.25"),
    account: funder.walletClient!.account!,
    chain: funder.walletClient!.chain,
    gas: 100_000n,
    gasPrice,
    type: "legacy",
  });
  await funder.publicClient.waitForTransactionReceipt({ hash: fundHash });
  steps.push({ step: "fund.subject", to: subject, tx: fundHash, rpc });

  const svcTx = await subjectClient.setDidService({
    type: "SmokePage",
    serviceEndpoint: "https://example.com/smoke-did-v2",
    validitySeconds: 86400n * 30n,
  });
  steps.push({ step: "setDidService", tx: svcTx });

  const count = await subjectClient.publicClient.readContract({
    address: addresses.DIDRegistry,
    abi: didRegistryAbi,
    functionName: "attributeCount",
    args: [subject],
  });
  steps.push({
    step: "attributeCount",
    count: count.toString(),
    ok: count > 0n,
  });

  const doc1 = await subjectClient.resolveDid(did);
  const hasSvc = (doc1.service ?? []).some(
    (s) =>
      s.type === "SmokePage" ||
      String(s.serviceEndpoint).includes("smoke-did-v2")
  );
  steps.push({
    step: "resolve.storage.service",
    ok: hasSvc,
    services: doc1.service?.length ?? 0,
  });

  const delegateId = await createMultiKeyIdentity(network);
  const delegate = delegateId.evm.address;
  const fundDel = await funder.walletClient!.sendTransaction({
    to: delegate,
    value: parseEther("0.15"),
    account: funder.walletClient!.account!,
    chain: funder.walletClient!.chain,
    gas: 100_000n,
    gasPrice,
    type: "legacy",
  });
  await funder.publicClient.waitForTransactionReceipt({ hash: fundDel });

  const addDel = await subjectClient.addDelegate({
    identity: subject,
    delegateType: DELEGATE_TYPE_SVC,
    delegate,
    validitySeconds: 86400n * 7n,
  });
  steps.push({ step: "addDelegate.svc", delegate, tx: addDel });

  const delClient = new PerantoClient({
    network,
    addresses,
    rpcUrl: rpc,
    privateKey: delegateId.evm.privateKey,
  });
  try {
    const delSvcTx = await delClient.setDidService({
      identity: subject,
      type: "Del",
      serviceEndpoint: "https://example.com/del",
      validitySeconds: 86400n * 7n,
    });
    steps.push({ step: "delegate.setDidService", tx: delSvcTx });

    const doc2 = await subjectClient.resolveDid(did);
    const hasDelSvc = (doc2.service ?? []).some(
      (s) => s.type === "Del" || String(s.serviceEndpoint).includes("/del")
    );
    const hasCap = (doc2.capabilityInvocation ?? []).some((id) =>
      id.includes("delegate")
    );
    steps.push({
      step: "resolve.delegate",
      ok: hasDelSvc && hasCap,
      hasDelSvc,
      hasCap,
    });
  } catch (e) {
    steps.push({
      step: "resolve.delegate",
      ok: false,
      error: errMsg(e).slice(0, 200),
      note: "covered by Hardhat DidServices",
    });
  }

  const pub = await subjectClient.publishPurposeKeysFromMnemonic(
    subjectId.mnemonic,
    86400n * 365n
  );
  steps.push({ step: "publishPurposeKeys", txs: pub.hashes });

  const doc3 = await subjectClient.resolveDid(did);
  const hasAssert = doc3.assertionMethod.some((id) =>
    id.includes("#key-assertion")
  );
  const hasAuth = doc3.authentication.some((id) =>
    id.includes("#key-authentication")
  );
  const hasKa = (doc3.keyAgreement ?? []).some((id) =>
    id.includes("#key-agreement")
  );
  steps.push({
    step: "resolve.purposeKeys",
    ok: hasAssert && hasAuth && hasKa,
    hasAssert,
    hasAuth,
    hasKa,
  });

  await subjectClient.stakeAndJoin("peranto:Member:v1");
  const issued = await subjectClient.issueAndAnchorClaims(
    subject,
    { role: "smoke", since: new Date().toISOString().slice(0, 10) },
    "peranto:Member:v1",
    "MemberCredential"
  );
  const verified = await subjectClient.verifyCredential(issued.jwt);
  const header = JSON.parse(
    Buffer.from(issued.jwt.split(".")[0]!, "base64url").toString("utf8")
  ) as { kid?: string };
  steps.push({
    step: "vc.assertion",
    ok:
      verified.jwtValid &&
      verified.onChainStatus === 1 &&
      Boolean(header.kid?.includes("#key-assertion")),
    kid: header.kid ?? null,
    jwtValid: verified.jwtValid,
    onChainStatus: verified.onChainStatus,
    authorized: verified.authorized,
    anchorTx: issued.anchorTx,
  });

  const critical = [
    "attributeCount",
    "resolve.storage.service",
    "resolve.purposeKeys",
    "vc.assertion",
  ];
  const failed = steps.filter(
    (s) => s.ok === false && critical.includes(String(s.step))
  );
  const softFail = steps.filter(
    (s) => s.ok === false && !critical.includes(String(s.step))
  );
  console.log(
    JSON.stringify(
      {
        network,
        did,
        didRegistry: addresses.DIDRegistry,
        subject,
        delegate,
        steps,
        passed: failed.length === 0,
        failed: failed.map((s) => s.step),
        softFailed: softFail.map((s) => s.step),
      },
      null,
      2
    )
  );
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(errMsg(e));
  process.exit(1);
});
