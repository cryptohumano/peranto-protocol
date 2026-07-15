import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Polkadot util-crypto espera Buffer en el browser (HD / Substrate).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Buffer ??= Buffer;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
