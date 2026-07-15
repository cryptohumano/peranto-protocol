import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";
import path from "node:path";

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      "@peranto/sdk": path.resolve(__dirname, "../sdk/src/browser.ts"),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, "src/popup/index.html"),
      },
    },
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
});
