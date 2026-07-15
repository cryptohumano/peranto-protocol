/**
 * Isolated content script: bridges page ↔ Aura service worker.
 * Provider itself runs in MAIN world (see inpage/provider.ts) — no inline scripts.
 */
const CHANNEL = "aura-peranto";

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || data.channel !== CHANNEL || data.direction !== "inpage→cs") {
    return;
  }
  chrome.runtime.sendMessage(
    {
      type: "PROVIDER_REQUEST",
      id: data.id,
      method: data.method,
      params: data.params,
    },
    (response) => {
      const err = chrome.runtime.lastError;
      window.postMessage(
        {
          channel: CHANNEL,
          direction: "cs→inpage",
          id: data.id,
          result: !err && response?.ok ? response.data : undefined,
          error: err
            ? err.message
            : response?.ok
              ? undefined
              : (response?.error ?? "Aura error"),
        },
        "*"
      );
    }
  );
});
