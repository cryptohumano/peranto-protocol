import type { ExtensionMessage, ExtensionResponse } from "./types";
import * as storage from "./storage";
import {
  createNewIdentity,
  importIdentity,
  importMnemonic,
  updateSettings,
  importDeploymentJson,
  runAction,
} from "./actions";
import { handleProviderRequest } from "./provider";

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? `0x${v.toString(16)}` : v
    )
  );
}

/**
 * Despacha mensajes de Aura.
 * Preferir ejecutarlo en el popup (tiene `window` — viem/RPC lo necesitan).
 * El service worker lo reutiliza para callers externos futuros.
 */
export async function dispatch(
  message: ExtensionMessage
): Promise<ExtensionResponse> {
  switch (message.type) {
    case "GET_STATE":
      return { ok: true, state: await storage.getState() };

    case "CREATE_IDENTITY":
      return { ok: true, state: await createNewIdentity() };

    case "IMPORT_IDENTITY":
      return { ok: true, state: await importIdentity(message.privateKey) };

    case "IMPORT_MNEMONIC":
      return { ok: true, state: await importMnemonic(message.mnemonic) };

    case "CLEAR_IDENTITY":
      await storage.setIdentity(null);
      return { ok: true, state: await storage.getState() };

    case "UPDATE_SETTINGS":
      return { ok: true, state: await updateSettings(message.settings) };

    case "IMPORT_DEPLOYMENT":
      return { ok: true, state: await importDeploymentJson(message.json) };

    case "ACTION": {
      const data = await runAction(message.action, message.payload ?? {});
      return { ok: true, state: await storage.getState(), data };
    }

    case "PROVIDER_REQUEST": {
      const data = await handleProviderRequest(
        message.method,
        message.params ?? []
      );
      return { ok: true, data: jsonSafe(data) };
    }

    default:
      return { ok: false, error: "Mensaje desconocido" };
  }
}
