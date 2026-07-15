import type { Address, Hex } from "viem";

/** Shared shape for JWT vault entries (Aura / IndexedDB / CLI). */
export type VaultCredential = {
  id: string;
  jwt: string;
  credHash: Hex;
  schemaKey: string;
  subjectDid: string;
  issuerDid: string;
  storedAt: string;
  label?: string;
};

export type VaultIdentity = {
  address: Address;
  did: string;
  privateKey?: Hex;
  mnemonic?: string;
};

const IDB_NAME = "peranto-vault-v1";
const STORE = "credentials";
const META = "meta";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no disponible"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

/** Browser IndexedDB keystore for JWT VCs (PWA / portal without Aura). */
export class IndexedDbVault {
  async list(): Promise<VaultCredential[]> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const all = await idbReq(tx.objectStore(STORE).getAll());
    db.close();
    return (all as VaultCredential[]) ?? [];
  }

  async put(cred: VaultCredential): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(cred);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("put failed"));
    });
    db.close();
  }

  async remove(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
    });
    db.close();
  }

  async clear(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
    });
    db.close();
  }
}

export function vaultIdFromHash(credHash: string): string {
  return credHash.toLowerCase();
}
