import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getReadClient } from "@/lib/client";
import { shortAddr } from "@/lib/utils";

type TreasurySnap = Awaited<
  ReturnType<Awaited<ReturnType<typeof getReadClient>>["getProtocolTreasuryStatus"]>
>;
type NodeSnap = Awaited<
  ReturnType<Awaited<ReturnType<typeof getReadClient>>["getNodeEconomy"]>
>;

function Wei({ value }: { value: bigint }) {
  const eth = Number(formatEther(value));
  return (
    <span className="font-mono tabular-nums">
      {eth < 0.0001 && value > 0n ? formatEther(value) : eth.toFixed(4)} PAS
    </span>
  );
}

export function TreasuryPage() {
  const [proto, setProto] = useState<TreasurySnap | null>(null);
  const [nodes, setNodes] = useState<NodeSnap[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const client = await getReadClient();
      const status = await client.getProtocolTreasuryStatus();
      setProto(status);
      const list = await client.listNodes();
      const economies = await Promise.all(
        list.map((a) => client.getNodeEconomy(a as Address))
      );
      setNodes(economies);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
            Tesoros
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink)]/70">
            ProtocolTreasury (commons) y saldos / epoch por nodo DisCO.
          </p>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void refresh()}>
          Refrescar
        </Button>
      </div>

      {err && <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>}

      {proto && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Tesoro de protocolo</CardTitle>
              <CardDesc>
                {shortAddr(proto.address)} · bloque {proto.blockNumber.toString()}
              </CardDesc>
            </div>
            <Badge>epoch {proto.currentPeriod.toString()}</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Balance" value={<Wei value={proto.balance} />} />
            <Stat label="Ingresos (Depósitos)" value={<Wei value={proto.incomeWei} />} />
            <Stat label="Egresos (Distribute)" value={<Wei value={proto.egressWei} />} />
            <Stat label="Nodos" value={proto.nodeCount.toString()} />
            <Stat
              label="Periodo / blocks"
              value={`${proto.currentPeriod.toString()} / ${proto.periodBlocks.toString()}`}
            />
            <Stat
              label="Distribute este epoch"
              value={proto.distributedThisPeriod ? "hecho" : "pendiente"}
            />
            <Stat label="equalBps / weightBps" value={`${proto.equalBps} / ${proto.weightBps}`} />
            <Stat
              label="# eventos"
              value={`${proto.depositCount} in · ${proto.distributeCount} out`}
            />
          </div>
        </Card>
      )}

      <h2 className="mb-3 font-display text-xl font-semibold text-[var(--color-moss-deep)]">
        Nodos DisCO
      </h2>
      <div className="grid gap-4">
        {nodes.map((n) => (
          <Card key={n.address}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{n.name}</CardTitle>
                <CardDesc>{shortAddr(n.address)}</CardDesc>
              </div>
              <div className="flex gap-1">
                <Badge>epoch {n.currentPeriod.toString()}</Badge>
                {n.periodHarvested ? <Badge>harvested</Badge> : <Badge>open</Badge>}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Balance nodo" value={<Wei value={n.balance} />} />
              <Stat label="Ingresos" value={<Wei value={n.incomeWei} />} />
              <Stat label="Egresos (harvest)" value={<Wei value={n.egressWei} />} />
              <Stat label="Miembros" value={n.memberCount.toString()} />
              <Stat label="Love / Care / Anchors" value={`${n.periodLove}/${n.periodCare}/${n.periodAnchors}`} />
              <Stat label="Federation links" value={n.periodFederationLinks.toString()} />
              <Stat label="sustainBps" value={`${n.sustainBps.toString()} (${Number(n.sustainBps) / 100}%)`} />
              <Stat label="Tips→nodo / Contribute" value={<><Wei value={n.tipsInWei} /> / <Wei value={n.contributeToNodeWei} /></>} />
              <Stat label="A protocolo (20%)" value={<Wei value={n.contributeToProtocolWei} />} />
              <Stat label="periodBlocks" value={n.periodBlocks.toString()} />
              <Stat label="createdPeriod" value={n.createdPeriod.toString()} />
              <Stat label="reserveFloor" value={<Wei value={n.reserveFloor} />} />
            </div>
          </Card>
        ))}
        {nodes.length === 0 && !busy && (
          <p className="text-sm text-[var(--color-ink)]/55">Sin nodos registrados.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-moss)]/10 bg-white/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink)]/50">
        {label}
      </p>
      <div className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{value}</div>
    </div>
  );
}
