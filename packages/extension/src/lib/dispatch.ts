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
import {
  forgetAllTrustedSites,
  forgetTrustedSite,
  getTrustedSites,
  getPendingAuthorization,
  approvePendingSite,
  rejectPendingSite,
} from "./domain-gate";
import {
  getPendingHolder,
  approvePendingSave,
  approvePendingShare,
  approvePendingProve,
  rejectPendingHolder,
} from "./holder-flow";

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
        message.params ?? [],
        {
          origin: message.origin,
          pathname: message.pathname,
          pageHref: message.pageHref,
          didConfiguration: message.didConfiguration,
        }
      );
      return { ok: true, data: jsonSafe(data) };
    }

    case "FORGET_TRUSTED_SITE": {
      await forgetTrustedSite(message.origin);
      const sites = await getTrustedSites();
      await storage.setTrustedSites(sites);
      return { ok: true, state: await storage.getState() };
    }

    case "FORGET_ALL_TRUSTED_SITES": {
      await forgetAllTrustedSites();
      await storage.setTrustedSites([]);
      return { ok: true, state: await storage.getState() };
    }

    case "GET_PENDING_AUTH": {
      const pending = await getPendingAuthorization();
      return { ok: true, data: pending, state: await storage.getState() };
    }

    case "APPROVE_PENDING_SITE": {
      const approved = await approvePendingSite();
      return {
        ok: true,
        data: approved,
        state: await storage.getState(),
      };
    }

    case "REJECT_PENDING_SITE": {
      await rejectPendingSite();
      const sites = await getTrustedSites();
      await storage.setTrustedSites(sites);
      return { ok: true, state: await storage.getState() };
    }

    case "GET_PENDING_HOLDER": {
      const pending = await getPendingHolder();
      return { ok: true, data: pending, state: await storage.getState() };
    }

    case "APPROVE_SAVE_CREDENTIAL": {
      await approvePendingSave();
      return { ok: true, state: await storage.getState() };
    }

    case "APPROVE_SHARE_CREDENTIAL": {
      await approvePendingShare(message.credHash, message.disclose);
      return { ok: true, state: await storage.getState() };
    }

    case "APPROVE_PROVE_COMPLIANCE": {
      await approvePendingProve();
      return { ok: true, state: await storage.getState() };
    }

    case "REJECT_HOLDER_REQUEST": {
      await rejectPendingHolder(message.reason);
      return { ok: true, state: await storage.getState() };
    }

    default:
      return { ok: false, error: "Mensaje desconocido" };
  }
}
