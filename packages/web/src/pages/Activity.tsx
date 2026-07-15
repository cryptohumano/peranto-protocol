import { useCallback, useEffect, useState } from "react";
import type { ActivityTx } from "@peranto/sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { loadSession } from "@/lib/session";
import {
  loadCachedActivity,
  syncUserActivity,
} from "@/lib/activity-sync";
import { activityColumns } from "@/components/transactions/columns";
import { ActivityDataTable } from "@/components/transactions/data-table";
import { Navigate } from "react-router-dom";

export function ActivityPage() {
  const session = loadSession();
  const [rows, setRows] = useState<ActivityTx[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<{
    added: number;
    fromCache: number;
    lastBlock: string;
    syncedAt: string;
  } | null>(null);

  const refresh = useCallback(async (forceFullLookback = false) => {
    const s = loadSession();
    if (!s) return;
    setBusy(true);
    setErr("");
    try {
      // Paint cache immediately
      const cached = await loadCachedActivity(s.address);
      if (cached.length) setRows(cached);

      const result = await syncUserActivity(s.address, undefined, {
        forceFullLookback,
      });
      setRows(result.rows);
      setMeta({
        added: result.added,
        fromCache: result.fromCache,
        lastBlock: result.lastBlock.toString(),
        syncedAt: result.syncedAt,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!session) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
            Transacciones
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink)]/70">
            La web busca actividad on-chain de tu address y la guarda en IndexedDB.
            Cada refresco solo descarga bloques nuevos y acumula el historial local.
          </p>
          {meta && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">{meta.fromCache} en cache</Badge>
              <Badge variant="outline">+{meta.added} en sync</Badge>
              <Badge variant="outline">bloque {meta.lastBlock}</Badge>
              <span className="text-[11px] text-muted-foreground">
                sync {new Date(meta.syncedAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void refresh(true)}
            title="Relee la ventana lookback completa"
          >
            Rescan
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void refresh(false)}
          >
            {busy ? "Sincronizando…" : "Refrescar"}
          </Button>
        </div>
      </header>

      {err && (
        <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>
      )}

      <ActivityDataTable columns={activityColumns} data={rows} />
    </div>
  );
}
