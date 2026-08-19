/**
 * Generate `packages/web/public/.well-known/did-configuration.json` for GitHub Pages.
 *
 * Env:
 *   PORTAL_DID_PRIVATE_KEY — issuer (portal operator) secp256k1 key
 *   PORTAL_ORIGIN — page origin, default https://cryptohumano.github.io
 *
 * Usage:
 *   PORTAL_DID_PRIVATE_KEY=0x… npm run portal:well-known
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { createDidConfigurationForOrigin } from "../packages/sdk/src/domain-linkage.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  __dirname,
  "../packages/web/public/.well-known/did-configuration.json"
);

const key = process.env.PORTAL_DID_PRIVATE_KEY?.trim() as Hex | undefined;
if (!key || key.length < 10) {
  console.error(
    "Missing PORTAL_DID_PRIVATE_KEY — set a portal operator key (never commit it)."
  );
  process.exit(1);
}

const origin =
  process.env.PORTAL_ORIGIN?.trim() || "https://cryptohumano.github.io";

const { didConfiguration, issued } = await createDidConfigurationForOrigin({
  issuerPrivateKey: key,
  network: "paseo",
  origin,
  expirationDate: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString(),
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(didConfiguration, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      issuerDid: issued.issuerDid,
      origin: issued.origin,
      out: OUT,
      deployPath:
        "/peranto-protocol/.well-known/did-configuration.json (GitHub Pages project site)",
    },
    null,
    2
  )
);
