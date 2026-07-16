/**
 * Seed: create DisCO node on existing deployment (no full redeploy).
 * Usage: npx hardhat run scripts/seed-node.ts --network paseo
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const network = await ethers.provider.getNetwork();
  const outFile = path.join(__dirname, "..", "deployments", `${network.chainId}.json`);
  const deployment = JSON.parse(fs.readFileSync(outFile, "utf8")) as {
    contracts: {
      DisCOFactory: string;
      PerantoNode: string | null;
      EcosystemLabNode?: string | null;
    };
  };

  const factory = await ethers.getContractAt(
    "DisCOFactory",
    deployment.contracts.DisCOFactory
  );
  const name = process.env.NODE_NAME ?? "EcosystemLab";
  const before = await factory.nodeCount();
  const tx = await factory.createNode(name);
  const receipt = await tx.wait();
  let node = (await factory.nodeByCreator(
    (await ethers.getSigners())[0]!.address
  )) as string;

  if (!node || node === ethers.ZeroAddress) {
    const after = await factory.nodeCount();
    if (after > before) {
      node = (await factory.allNodes(after - 1n)) as string;
    }
  }

  if (!node || node === ethers.ZeroAddress) {
    const parsed = receipt!.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((p) => p?.name === "NodeCreated");
    node = parsed?.args?.node as string;
  }

  if (!node || node === ethers.ZeroAddress) {
    throw new Error("Could not resolve created node address");
  }

  console.log(`Created node ${name} → ${node}`);
  if (name === "Peranto") {
    deployment.contracts.PerantoNode = node;
  } else {
    deployment.contracts.EcosystemLabNode = node;
    if (!deployment.contracts.PerantoNode) {
      deployment.contracts.PerantoNode = node;
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`Updated ${outFile}`);

  if (Number(network.chainId) === 420420417) {
    const body = JSON.stringify(deployment, null, 2);
    for (const rel of [
      ["deployments", "paseo.json"],
      ["packages", "web", "public", "deployments", "paseo.json"],
    ]) {
      const p = path.join(__dirname, "..", ...rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
      console.log(`Updated ${p}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
