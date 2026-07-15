/**
 * Polyfill mínimo para runtimes sin `window` (MV3 service worker).
 * Viem / algunos transports asumen `window` en el grafo de dependencias.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window ??= globalThis;

import { dispatch } from "../lib/dispatch";
import type { ExtensionMessage, ExtensionResponse } from "../lib/types";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Aura] installed");
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    dispatch(message)
      .then((res) => sendResponse(res))
      .catch((err: unknown) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ExtensionResponse);
      });
    return true;
  }
);
