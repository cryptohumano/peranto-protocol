import type { Address, Hex } from "viem";
import type { ActivityTx, ActivityTxType } from "./activity";

const IDB_NAME = "peranto-activity-v1";
const STORE_TXS = "txs";
const STORE_SYNC = "sync";
const DB_VERSION = 1;

/** Serializable row for IndexedDB (no bigint). */
export type StoredActivityTx = {
  id: string;
  /** Lowercase owner address this tx was indexed for. */
  account: string;
  network: string;
  type: ActivityTxType;
  label: string;
  txHash: Hex;
  blockNumber: string;
  logIndex: number;
  counterpart?: Address;
  valueWei?: string;
  detail?: string;
  node?: Address;
  role?: ActivityTx["role"];
  syncedAt: string;
};

export type ActivitySyncCursor = {
  id: string;
  account: string;
  network: string;
  lastBlock: string;
  syncedAt: string;
  rowCount: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no disponible"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TXS)) {
        const store = db.createObjectStore(STORE_TXS, { keyPath: "id" });
        store.createIndex("byAccount", "account", { unique: false });
        store.createIndex("byAccountNetwork", ["account", "network"], {
          unique: false,
        });
      }
      if (!db.objectStoreNames.contains(STORE_SYNC)) {
        db.createObjectStore(STORE_SYNC, { keyPath: "id" });
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

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB tx aborted"));
  });
}

export function syncKey(account: Address, network: string): string {
  return `${account.toLowerCase()}::${network}`;
}

export function activityToStored(
  tx: ActivityTx,
  account: Address,
  network: string
): StoredActivityTx {
  return {
    id: `${account.toLowerCase()}::${network}::${tx.id}`,
    account: account.toLowerCase(),
    network,
    type: tx.type,
    label: tx.label,
    txHash: tx.txHash,
    blockNumber: tx.blockNumber.toString(),
    logIndex: tx.logIndex,
    counterpart: tx.counterpart,
    valueWei: tx.valueWei !== undefined ? tx.valueWei.toString() : undefined,
    detail: tx.detail,
    node: tx.node,
    role: tx.role,
    syncedAt: new Date().toISOString(),
  };
}

export function storedToActivity(row: StoredActivityTx): ActivityTx {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    txHash: row.txHash,
    blockNumber: BigInt(row.blockNumber),
    logIndex: row.logIndex,
    counterpart: row.counterpart,
    valueWei: row.valueWei !== undefined ? BigInt(row.valueWei) : undefined,
    detail: row.detail,
    node: row.node,
    role: row.role,
  };
}

/** Browser IndexedDB cache of on-chain activity per account. */
export class IndexedDbActivityStore {
  async list(
    account: Address,
    network?: string
  ): Promise<StoredActivityTx[]> {
    const db = await openDb();
    const tx = db.transaction(STORE_TXS, "readonly");
    const store = tx.objectStore(STORE_TXS);
    const acc = account.toLowerCase();
    let rows: StoredActivityTx[];
    if (network) {
      const idx = store.index("byAccountNetwork");
      rows = (await idbReq(
        idx.getAll(IDBKeyRange.only([acc, network]))
      )) as StoredActivityTx[];
    } else {
      const idx = store.index("byAccount");
      rows = (await idbReq(idx.getAll(acc))) as StoredActivityTx[];
    }
    await waitTx(tx);
    db.close();
    rows.sort((a, b) => {
      const ba = BigInt(a.blockNumber);
      const bb = BigInt(b.blockNumber);
      if (ba === bb) return b.logIndex - a.logIndex;
      return ba > bb ? -1 : 1;
    });
    return rows;
  }

  async putMany(rows: StoredActivityTx[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(STORE_TXS, "readwrite");
    const store = tx.objectStore(STORE_TXS);
    for (const row of rows) {
      store.put(row);
    }
    await waitTx(tx);
    db.close();
  }

  async getSync(
    account: Address,
    network: string
  ): Promise<ActivitySyncCursor | null> {
    const db = await openDb();
    const tx = db.transaction(STORE_SYNC, "readonly");
    const row = (await idbReq(
      tx.objectStore(STORE_SYNC).get(syncKey(account, network))
    )) as ActivitySyncCursor | undefined;
    await waitTx(tx);
    db.close();
    return row ?? null;
  }

  async setSync(cursor: Omit<ActivitySyncCursor, "id"> & { id?: string }): Promise<void> {
    const id = cursor.id ?? syncKey(cursor.account as Address, cursor.network);
    const db = await openDb();
    const tx = db.transaction(STORE_SYNC, "readwrite");
    tx.objectStore(STORE_SYNC).put({ ...cursor, id, account: cursor.account });
    await waitTx(tx);
    db.close();
  }

  async clearAccount(account: Address, network?: string): Promise<void> {
    const rows = await this.list(account, network);
    const db = await openDb();
    const tx = db.transaction([STORE_TXS, STORE_SYNC], "readwrite");
    const store = tx.objectStore(STORE_TXS);
    for (const row of rows) {
      store.delete(row.id);
    }
    if (network) {
      tx.objectStore(STORE_SYNC).delete(syncKey(account, network));
    }
    await waitTx(tx);
    db.close();
  }
}
