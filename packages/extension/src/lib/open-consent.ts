/**
 * Open Aura UI for user consent (Sporran-style window).
 * Badge alone is not enough — MV3 does not auto-open the action popup.
 */
let consentWindowId: number | undefined;

export async function openAuraConsentWindow(): Promise<void> {
  const url = chrome.runtime.getURL("src/popup/index.html");

  try {
    if (consentWindowId !== undefined) {
      try {
        const w = await chrome.windows.get(consentWindowId);
        if (w.id !== undefined) {
          await chrome.windows.update(w.id, { focused: true });
          return;
        }
      } catch {
        consentWindowId = undefined;
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const win = await chrome.windows.create({
      url,
      type: "popup",
      width: 400,
      height: 640,
      focused: true,
    });
    consentWindowId = win.id;
  } catch (e) {
    console.warn("[Aura] no se pudo abrir ventana de consentimiento", e);
    // Fallback: try action popup (may no-op without user gesture)
    try {
      await chrome.action.openPopup();
    } catch {
      /* user must click the extension icon */
    }
  }
}

export function clearConsentWindowId(id?: number) {
  if (id === undefined || id === consentWindowId) {
    consentWindowId = undefined;
  }
}
