import { defineConfig, type Plugin } from "vite";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createDidConfigurationForOrigin } from "../sdk/src/domain-linkage";

const PORT = 5174;
const ORIGIN = `http://localhost:${PORT}`;
const NETWORK = "paseo" as const;

/** Stable Hardhat #0 key — lab only, never use with real funds. */
const LAB_KEY =
  (process.env.AURA_LAB_PRIVATE_KEY as Hex | undefined) ??
  ("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex);

function auraLabWellKnown(): Plugin {
  let didConfiguration: unknown;
  let serviceDid = "";

  return {
    name: "aura-lab-well-known",
    async buildStart() {
      const account = privateKeyToAccount(LAB_KEY);
      const { didConfiguration: cfg, issued } =
        await createDidConfigurationForOrigin({
          issuerPrivateKey: LAB_KEY,
          network: NETWORK,
          origin: ORIGIN,
        });
      didConfiguration = cfg;
      serviceDid = issued.issuerDid;
      console.log(`[aura-lab] service DID ${serviceDid}`);
      console.log(`[aura-lab] well-known ready for ${ORIGIN}`);
      console.log(`[aura-lab] attester address ${account.address}`);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/.well-known/did-configuration.json")) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(JSON.stringify(didConfiguration ?? {}, null, 2));
          return;
        }
        if (req.url?.startsWith("/api/lab-meta")) {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              origin: ORIGIN,
              network: NETWORK,
              serviceDid,
              attesterAddress: privateKeyToAccount(LAB_KEY).address,
              labPrivateKey: LAB_KEY,
            })
          );
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [auraLabWellKnown()],
  resolve: {
    alias: {
      "@peranto/sdk": path.resolve(__dirname, "../sdk/src/browser.ts"),
    },
  },
  server: {
    port: PORT,
    strictPort: true,
    watch: {
      // Avoid ENOSPC when fs.inotify.max_user_watches is low (Cursor + monorepo).
      usePolling: true,
      interval: 1000,
    },
  },
  define: {
    "process.env": {},
  },
});
