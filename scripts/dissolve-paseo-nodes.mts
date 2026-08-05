import { readFileSync } from "fs";
import { PerantoClient } from "../packages/sdk/dist/client.js";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const pk = env.PRIVATE_KEY!.startsWith("0x")
  ? env.PRIVATE_KEY!
  : `0x${env.PRIVATE_KEY}`;
const dep = JSON.parse(readFileSync("deployments/paseo.json", "utf8"));
const addresses = {
  ProtocolTreasury: dep.contracts.ProtocolTreasury,
  DisCOFactory: dep.contracts.DisCOFactory,
  DIDRegistry: dep.contracts.DIDRegistry,
  SchemaRegistry: dep.contracts.SchemaRegistry,
  AttesterRegistry: dep.contracts.AttesterRegistry,
  CredentialStatusRegistry: dep.contracts.CredentialStatusRegistry,
  NameRegistry: dep.contracts.NameRegistry,
};
const client = new PerantoClient({
  network: "paseo",
  rpcUrl: process.env.PERANTO_RPC_URL || "https://eth-rpc-testnet.polkadot.io/",
  privateKey: pk as `0x${string}`,
  addresses,
});
const to = client.accountAddress!;
const nodes = [
  dep.contracts.PerantoNode,
  dep.contracts.EcosystemLabNode,
].filter(Boolean);
for (const node of nodes) {
  try {
    console.log("dissolving", node);
    const res = await client.dissolveNode(node, to);
    console.log(JSON.stringify(res));
  } catch (e) {
    console.error("dissolve failed", node, e instanceof Error ? e.message : e);
  }
}
console.log("done");
