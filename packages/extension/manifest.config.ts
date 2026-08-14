import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Aura Wallet",
  description:
    "Wallet did:peranto — identidad, credenciales EcoTest, tip/DisCO y nombres",
  version: pkg.version,
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Aura Wallet",
    default_icon: {
      "16": "public/icons/icon16.png",
      "48": "public/icons/icon48.png",
      "128": "public/icons/icon128.png",
    },
  },
  icons: {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://localhost/*", "http://127.0.0.1/*", "https://*/*"],
      js: ["src/inpage/provider.ts"],
      run_at: "document_start",
      all_frames: false,
      world: "MAIN",
    },
    {
      matches: ["http://localhost/*", "http://127.0.0.1/*", "https://*/*"],
      js: ["src/content/bridge.ts"],
      run_at: "document_start",
      all_frames: false,
      world: "ISOLATED",
    },
  ],
  permissions: ["storage"],
  host_permissions: [
    "http://127.0.0.1:8545/*",
    "http://localhost:8545/*",
    "http://localhost:5173/*",
    "http://127.0.0.1:5173/*",
    "http://localhost:5174/*",
    "http://127.0.0.1:5174/*",
    "http://localhost:8787/*",
    "http://127.0.0.1:8787/*",
    "https://eth-rpc-testnet.polkadot.io/*",
    "https://crs.aztec-cdn.foundation/*",
    "https://crs.aztec-labs.com/*",
  ],
  // @polkadot/wasm-crypto needs WASM compile in popup/SW (MV3 default CSP forbids it)
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
});
