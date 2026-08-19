import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";
import type { Hex } from "viem";
import { createDidConfigurationForOrigin } from "../sdk/src/domain-linkage";

/** Project Pages: `/peranto-protocol/`. Override with `VITE_BASE=/` for local/custom hosts. */
const base = process.env.VITE_BASE ?? "/";

const PORTAL_ORIGIN =
  process.env.PORTAL_ORIGIN?.trim() || "https://cryptohumano.github.io";

function portalWellKnownPlugin(): Plugin {
  return {
    name: "portal-well-known",
    async buildStart() {
      const outDir = path.resolve(__dirname, "public/.well-known");
      const outFile = path.join(outDir, "did-configuration.json");
      const key = process.env.PORTAL_DID_PRIVATE_KEY?.trim() as Hex | undefined;

      if (!key || key.length < 10) {
        if (fs.existsSync(outFile)) {
          console.log(
            `[portal] using committed ${outFile} (set PORTAL_DID_PRIVATE_KEY to regenerate)`
          );
          return;
        }
        console.warn(
          "[portal] skip well-known: no PORTAL_DID_PRIVATE_KEY and no committed file"
        );
        return;
      }

      const { didConfiguration, issued } =
        await createDidConfigurationForOrigin({
          issuerPrivateKey: key,
          network: "paseo",
          origin: PORTAL_ORIGIN,
          expirationDate: new Date(
            Date.now() + 5 * 365 * 24 * 60 * 60 * 1000
          ).toISOString(),
        });
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, `${JSON.stringify(didConfiguration, null, 2)}\n`);
      console.log(
        `[portal] well-known for ${issued.origin} → ${outFile} (issuer ${issued.issuerDid})`
      );
    },
  };
}

export default defineConfig({
  base,
  plugins: [portalWellKnownPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@peranto/sdk": path.resolve(__dirname, "../sdk/src/browser.ts"),
      buffer: "buffer/",
    },
  },
  optimizeDeps: {
    include: ["buffer"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
  server: {
    port: 5173,
  },
});
