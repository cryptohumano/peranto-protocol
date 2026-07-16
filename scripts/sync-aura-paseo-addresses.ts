/**
 * After `npm run deploy:paseo`, patch Aura bundled addresses from deployments/420420417.json
 * so a fresh extension build points at the new stack without manual paste.
 *
 * Usage: npx tsx scripts/sync-aura-paseo-addresses.ts
 */
import * as fs from "fs";
import * as path from "path";

const root = path.join(__dirname, "..");
const depFile = path.join(root, "deployments", "420420417.json");
const typesFile = path.join(
  root,
  "packages",
  "extension",
  "src",
  "lib",
  "types.ts"
);

if (!fs.existsSync(depFile)) {
  console.error(`Missing ${depFile} — run deploy:paseo first`);
  process.exit(1);
}

const dep = JSON.parse(fs.readFileSync(depFile, "utf8")) as {
  contracts: Record<string, string | null>;
};
const c = dep.contracts;
const block = `export const DEFAULT_PASEO_ADDRESSES: ContractAddresses = {
  ProtocolTreasury: "${c.ProtocolTreasury}",
  DisCOFactory: "${c.DisCOFactory}",
  PerantoNode: ${c.PerantoNode ? `"${c.PerantoNode}"` : "null"},
  EcosystemLabNode: ${c.EcosystemLabNode ? `"${c.EcosystemLabNode}"` : "null"},
  DIDRegistry: "${c.DIDRegistry}",
  SchemaRegistry: "${c.SchemaRegistry}",
  AttesterRegistry: "${c.AttesterRegistry}",
  CredentialStatusRegistry: "${c.CredentialStatusRegistry}",
  NameRegistry: "${c.NameRegistry}",
};`;

let src = fs.readFileSync(typesFile, "utf8");
const re =
  /export const DEFAULT_PASEO_ADDRESSES: ContractAddresses = \{[\s\S]*?\};/;
if (!re.test(src)) {
  console.error("DEFAULT_PASEO_ADDRESSES block not found in types.ts");
  process.exit(1);
}
src = src.replace(re, block);
fs.writeFileSync(typesFile, src);
console.log(`Updated ${typesFile}`);
console.log(block);
