/**
 * One-shot: MNEMONIC or .mnemonic.local → escribe PRIVATE_KEY en .env (gitignored).
 * No imprime el mnemonic.
 *
 *   echo 'word1 … word12' > .mnemonic.local
 *   npx tsx scripts/write-deployer-env.ts
 *   rm -f .mnemonic.local
 */
import * as fs from "fs";
import * as path from "path";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex } from "viem";

const root = path.resolve(__dirname, "..");
const mnemonicPath = path.join(root, ".mnemonic.local");
const envPath = path.join(root, ".env");

function loadMnemonic(): string {
  if (process.env.MNEMONIC?.trim()) return process.env.MNEMONIC.trim();
  if (fs.existsSync(mnemonicPath)) {
    return fs.readFileSync(mnemonicPath, "utf8").trim().replace(/\s+/g, " ");
  }
  throw new Error(
    "Provide MNEMONIC env or create .mnemonic.local (gitignored), then delete it."
  );
}

function main() {
  const mnemonic = loadMnemonic();
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error("Invalid BIP39 mnemonic");
  }
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!child.privateKey) throw new Error("HD derive failed");
  const privateKey = bytesToHex(child.privateKey);
  const account = privateKeyToAccount(privateKey);

  const example = fs.existsSync(path.join(root, ".env.example"))
    ? fs.readFileSync(path.join(root, ".env.example"), "utf8")
    : "";
  const lines = example
    ? example.split("\n").map((line) => {
        if (line.startsWith("PRIVATE_KEY=")) return `PRIVATE_KEY=${privateKey}`;
        return line;
      })
    : [`PRIVATE_KEY=${privateKey}`];
  if (!example.includes("PRIVATE_KEY=")) {
    lines.unshift(`PRIVATE_KEY=${privateKey}`);
  }
  fs.writeFileSync(envPath, lines.join("\n").endsWith("\n") ? lines.join("\n") : lines.join("\n") + "\n");
  console.log(`Wrote ${envPath}`);
  console.log(`Deployer address: ${account.address}`);
  console.log("Do NOT commit .env. Delete .mnemonic.local if present.");
}

main();
