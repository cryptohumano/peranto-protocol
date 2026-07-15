import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { Heart, HandHeart, Store } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpCallout } from "@/components/HelpCallout";
import { DiscoContextBar } from "@/components/DiscoContextBar";
import { getReadClient } from "@/lib/client";
import {
  defaultOffers,
  loadActiveDisco,
  saveActiveDisco,
  type ActiveDisco,
} from "@/lib/disco";
import { loadSession } from "@/lib/session";
import { cn, shortAddr } from "@/lib/utils";
import { formatPas } from "@/lib/format";
import { disCONodeAbi } from "@peranto/sdk";

const SCHEMA_LABELS: Record<string, string> = {
  "peranto:Member:v1": "Member",
  "peranto:EcoTestResult:v1": "EcoTest",
  "peranto:CommonsWork:v1": "CommonsWork",
  "peranto:CareContribution:v1": "Care VC",
  "peranto:TipReceipt:v1": "TipReceipt",
};

type NodeRow = {
  address: Address;
  name: string;
  memberCount: bigint;
  balance: bigint;
  dissolved: boolean;
  periodLove: bigint;
  periodCare: bigint;
  periodAnchors: bigint;
  sustainBps: bigint;
  myLove?: bigint;
  myCare?: bigint;
  offerSchemas: string[];
};

export function EconomyPage() {
  const session = loadSession();
  const [disco, setDisco] = useState<ActiveDisco | null>(loadActiveDisco());
  const [rows, setRows] = useState<NodeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onDisco = (ev: Event) => {
      setDisco((ev as CustomEvent<ActiveDisco | null>).detail ?? loadActiveDisco());
    };
    window.addEventListener("peranto:disco", onDisco);
    return () => window.removeEventListener("peranto:disco", onDisco);
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const client = await getReadClient();
      const list = await client.listNodesWithMeta();
      const offers = defaultOffers();
      const active = loadActiveDisco();

      const next: NodeRow[] = await Promise.all(
        list.map(async (n) => {
          const [dissolved, economy, scores] = await Promise.all([
            client.publicClient.readContract({
              address: n.address,
              abi: disCONodeAbi,
              functionName: "dissolved",
            }) as Promise<boolean>,
            client.getNodeEconomy(n.address),
            session
              ? client.scores(n.address, session.address).catch(() => null)
              : Promise.resolve(null),
          ]);
          const offerSchemas =
            active?.address.toLowerCase() === n.address.toLowerCase() &&
            active.offerSchemas?.length
              ? active.offerSchemas
              : offers;
          return {
            address: n.address,
            name: n.name || economy.name,
            memberCount: economy.memberCount,
            balance: economy.balance,
            dissolved,
            periodLove: economy.periodLove,
            periodCare: economy.periodCare,
            periodAnchors: economy.periodAnchors,
            sustainBps: economy.sustainBps,
            myLove: scores?.love,
            myCare: scores?.care,
            offerSchemas,
          };
        })
      );
      setRows(next.filter((r) => !r.dissolved));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
            Economía solidaria
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink)]/70">
            DisCOs activos, servicios (schemas) y reputación Love/Care del
            periodo.
          </p>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void refresh()}>
          Refrescar
        </Button>
      </header>

      <DiscoContextBar disco={disco} />

      <HelpCallout title="¿Cómo se mide la reputación?">
        <p>
          <strong>Care</strong> sube cuando das un tip; <strong>Love</strong>{" "}
          cuando lo recibes. Son contadores on-chain del nodo (por tip, no por
          monto). Una VC <code className="text-[10px]">CareContribution</code> es
          evidencia portable — no mueve esos puntos.
        </p>
      </HelpCallout>

      {err && (
        <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>
      )}

      {rows.length === 0 && !busy && !err && (
        <Card>
          <CardTitle>Sin nodos activos</CardTitle>
          <CardDesc>
            Crea o únete a un DisCO en Cooperativa para ver servicios aquí.
          </CardDesc>
          <Link
            to="/coop"
            className={cn(buttonVariants({ size: "sm" }), "mt-3 inline-flex")}
          >
            Ir a Cooperativa
          </Link>
        </Card>
      )}

      <ul className="mt-4 space-y-3">
        {rows.map((r) => {
          const isActive =
            disco?.address.toLowerCase() === r.address.toLowerCase();
          return (
            <li key={r.address}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Store className="size-4 text-[var(--color-moss)]" />
                      <CardTitle>{r.name}</CardTitle>
                      {isActive && (
                        <Badge className="bg-[var(--color-moss)]/15 text-[var(--color-moss-deep)]">
                          DisCO activo
                        </Badge>
                      )}
                    </div>
                    <CardDesc>
                      {shortAddr(r.address)} · {r.memberCount.toString()} miembro
                      {r.memberCount === 1n ? "" : "s"} · {formatPas(r.balance)}{" "}
                      PAS
                    </CardDesc>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={isActive ? "secondary" : "default"}
                      onClick={() => {
                        saveActiveDisco({
                          address: r.address,
                          name: r.name,
                          offerSchemas: r.offerSchemas,
                        });
                        setDisco(loadActiveDisco());
                      }}
                    >
                      {isActive ? "En uso" : "Usar este DisCO"}
                    </Button>
                    <Link
                      to="/credentials"
                      className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                    >
                      Credenciales
                    </Link>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Servicios / schemas
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.offerSchemas.map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px]">
                        {SCHEMA_LABELS[s] ?? s.replace(/^peranto:/, "")}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-[var(--color-moss)]/12 bg-[var(--color-mist)]/30 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-moss)]">
                      <Heart className="size-3" />
                      Periodo — Love / Care
                    </p>
                    <p className="mt-1 font-display text-lg font-semibold text-[var(--color-moss-deep)]">
                      {r.periodLove.toString()} Love · {r.periodCare.toString()} Care
                    </p>
                    <p className="text-[11px] text-[var(--color-ink)]/50">
                      {r.periodAnchors.toString()} anclas · sustain{" "}
                      {(Number(r.sustainBps) / 100).toFixed(2)}%
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-moss)]/12 bg-[var(--color-mist)]/30 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-moss)]">
                      <HandHeart className="size-3" />
                      Tu reputación en este nodo
                    </p>
                    {session && r.myLove !== undefined && r.myCare !== undefined ? (
                      <p className="mt-1 font-display text-lg font-semibold text-[var(--color-moss-deep)]">
                        {r.myLove.toString()} Love · {r.myCare.toString()} Care
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-[var(--color-ink)]/55">
                        Inicia sesión para ver tus puntos.
                      </p>
                    )}
                    <p className="text-[11px] text-[var(--color-ink)]/50">
                      Acumulado vía tips (lifetime en el nodo).
                    </p>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
