/**
 * One-shot: register Member/CommonsWork/Care schemas on an existing deployment
 * without redeploying registries.
 *
 * Usage: npx hardhat run scripts/register-schemas.ts --network paseo
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SCHEMAS = [
  {
    key: "peranto:Member:v1",
    required: ["fullName", "status", "enrolledAt"],
    uri: "https://peranto.app/schemas/Member/v1.json",
  },
  {
    key: "peranto:CommonsWork:v1",
    required: ["title", "workedAt"],
    uri: "https://peranto.app/schemas/CommonsWork/v1.json",
  },
  {
    key: "peranto:CareContribution:v1",
    required: ["kind", "contributedAt"],
    uri: "https://peranto.app/schemas/CareContribution/v1.json",
  },
] as const;

async function main() {
  const network = await ethers.provider.getNetwork();
  const outFile = path.join(__dirname, "..", "deployments", `${network.chainId}.json`);
  if (!fs.existsSync(outFile)) {
    throw new Error(`Missing deployment ${outFile}`);
  }
  const deployment = JSON.parse(fs.readFileSync(outFile, "utf8")) as {
    contracts: { SchemaRegistry: string };
    schemas: Record<string, string>;
  };

  const schema = await ethers.getContractAt(
    "SchemaRegistry",
    deployment.contracts.SchemaRegistry
  );

  for (const s of SCHEMAS) {
    const schemaId = ethers.id(s.key);
    const exists = await schema.schemaExists(schemaId);
    if (exists) {
      console.log(`skip ${s.key} (already registered)`);
      deployment.schemas[s.key] = schemaId;
      continue;
    }
    const schemaHash = ethers.id(
      JSON.stringify({ $id: s.key, type: "object", required: [...s.required] })
    );
    const tx = await schema.registerSchema(schemaId, schemaHash, s.uri);
    await tx.wait();
    deployment.schemas[s.key] = schemaId;
    console.log(`registered ${s.key} → ${schemaId}`);
  }

  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`Updated ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
