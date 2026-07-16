import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FieldHint, HelpCallout } from "@/components/HelpCallout";
import { DiscoContextBar } from "@/components/DiscoContextBar";
import { loadSession } from "@/lib/session";
import {
  defaultOffers,
  loadActiveDisco,
  saveActiveDisco,
  type ActiveDisco,
} from "@/lib/disco";
import {
  getReadClient,
  portalAddMember,
  portalContribute,
  portalCreateNode,
  portalDissolveNode,
  portalTip,
} from "@/lib/client";
import { cn, shortAddr } from "@/lib/utils";
import { formatPas } from "@/lib/format";

type NodeMeta = {
  address: Address;
  name: string;
  memberCount: bigint;
  balanceWei?: bigint;
};

export function CoopPage() {
  const [nodes, setNodes] = useState<NodeMeta[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Address | "">("");
  const [members, setMembers] = useState<Address[]>([]);
  const [nodeName, setNodeName] = useState("EcosystemLab");
  const [seedAmt, setSeedAmt] = useState("0.1");
  const [reserveFloor, setReserveFloor] = useState("0");
  const [tipTo, setTipTo] = useState("");
  const [tipAmt, setTipAmt] = useState("0.01");
  const [memberAddr, setMemberAddr] = useState("");
  const [scores, setScores] = useState<{ love: bigint; care: bigint; period: bigint } | null>(
    null
  );
  const [disco, setDisco] = useState<ActiveDisco | null>(loadActiveDisco());
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const session = loadSession();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.address.toLowerCase().includes(q)
    );
  }, [nodes, query]);

  const refresh = useCallback(async () => {
    const client = await getReadClient();
    const list = await client.listNodesWithMeta();
    const withBal = await Promise.all(
      list.map(async (n) => {
        const balanceWei = await client.publicClient.getBalance({
          address: n.address,
        });
        return { ...n, balanceWei };
      })
    );
    setNodes(withBal);
    if (!selected && withBal[0]) setSelected(withBal[0].address);
  }, [selected]);

  useEffect(() => {
    void refresh().catch((e) => setErr(String(e)));
  }, [refresh]);

  useEffect(() => {
    const onDisco = () => setDisco(loadActiveDisco());
    window.addEventListener("peranto:disco", onDisco);
    return () => window.removeEventListener("peranto:disco", onDisco);
  }, []);

  useEffect(() => {
    if (!selected) return;
    void (async () => {
      const client = await getReadClient();
      setMembers(await client.getMembers(selected));
      if (session) {
        const s = await client.scores(selected, session.address);
        setScores({ love: s.love, care: s.care, period: s.currentPeriod });
      }
    })();
  }, [selected, session]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      await refresh();
      if (selected) {
        const client = await getReadClient();
        setMembers(await client.getMembers(selected));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function selectAsActive(n: NodeMeta) {
    saveActiveDisco({
      address: n.address,
      name: n.name,
      offerSchemas: defaultOffers(),
    });
    setDisco(loadActiveDisco());
    setSelected(n.address);
    setMsg(`DisCO activo: ${n.name}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
          Cooperativa
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink)]/70">
          Busca nodos DisCO, elige en cuál operar y pide unirte. Las
          credenciales se reclaman en el contexto del DisCO activo.
        </p>
      </header>

      <DiscoContextBar disco={disco} />

      <HelpCallout title="Unirse + reclamar" className="mb-4">
        <p>
          1) Elige un nodo → <strong>Usar este DisCO</strong>. 2) Pide a la
          gobernanza que te añada (o envía solicitud Member). 3) En{" "}
          <Link className="underline" to="/credentials">
            Credenciales
          </Link>{" "}
          reclama Member / EcoTest del catálogo público.
        </p>
      </HelpCallout>

      <Card className="mb-4">
        <CardTitle>Buscar nodos</CardTitle>
        <Input
          className="mt-3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre o address…"
        />
        <ul className="mt-4 space-y-2">
          {filtered.map((n) => {
            const active = disco?.address.toLowerCase() === n.address.toLowerCase();
            const selectedRow = selected === n.address;
            return (
              <li key={n.address}>
                <div
                  className={cn(
                    "rounded-2xl border px-3 py-3",
                    active
                      ? "border-[var(--color-moss)] bg-[var(--color-moss)]/10"
                      : selectedRow
                        ? "border-[var(--color-moss)]/40 bg-[var(--color-mist)]/40"
                        : "border-[var(--color-moss)]/12"
                  )}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => setSelected(n.address)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-semibold text-[var(--color-moss-deep)]">
                        {n.name}
                      </span>
                      {active && <Badge>Activo</Badge>}
                      <span className="text-xs text-[var(--color-ink)]/50">
                        {n.memberCount.toString()} miembros
                        {n.balanceWei !== undefined
                          ? ` · ${formatPas(n.balanceWei)} PAS`
                          : ""}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-[var(--color-ink)]/40">
                      {shortAddr(n.address, 8)}
                    </p>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => selectAsActive(n)}
                      disabled={active}
                    >
                      {active ? "DisCO en uso" : "Usar este DisCO"}
                    </Button>
                    <Link
                      to="/credentials"
                      className={cn(
                        buttonVariants({ size: "sm", variant: "secondary" })
                      )}
                      onClick={() => selectAsActive(n)}
                    >
                      Ver credenciales
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-[var(--color-ink)]/55">
              Ningún nodo coincide. Crea uno abajo o ajusta la búsqueda.
            </p>
          )}
        </ul>
      </Card>

      {selected && (
        <Card className="mb-4">
          <CardTitle>Nodo seleccionado</CardTitle>
          <CardDesc>
            Miembros on-chain. “Añadir” requiere gobernanza. Pedir unirte =
            avisar al gov / solicitar Member.
          </CardDesc>
          <ul className="mt-2 max-h-28 overflow-auto text-xs">
            {members.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {session && scores && (
            <p className="mt-2 text-xs text-[var(--color-ink)]/60">
              Tus puntos: Love {scores.love.toString()} · Care{" "}
              {scores.care.toString()}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const n = nodes.find((x) => x.address === selected);
                if (!n || !session) return;
                const body = {
                  type: "peranto.joinRequest",
                  disco: { name: n.name, address: n.address },
                  subject: { did: session.did, address: session.address },
                  schemaKey: "peranto:Member:v1",
                  createdAt: new Date().toISOString(),
                };
                void navigator.clipboard.writeText(JSON.stringify(body, null, 2));
                setMsg("Solicitud de unión copiada — envíala a la gobernanza");
              }}
            >
              Copiar pedido de unión
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowOps((v) => !v)}
            >
              {showOps ? "Ocultar operaciones" : "Tip / contribute / gov"}
            </Button>
          </div>
        </Card>
      )}

      {showOps && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardTitle>Añadir miembro (gov)</CardTitle>
            <Input
              className="mt-2"
              value={memberAddr}
              onChange={(e) => setMemberAddr(e.target.value)}
              placeholder="0x…"
            />
            <Button
              className="mt-2"
              size="sm"
              disabled={busy || !selected || !session}
              onClick={() =>
                run(async () => {
                  await portalAddMember(
                    selected as Address,
                    memberAddr as Address,
                    session
                  );
                  setMsg("Miembro añadido");
                })
              }
            >
              addMember
            </Button>
          </Card>
          <Card>
            <CardTitle>Tip</CardTitle>
            <Label className="mt-2">To</Label>
            <Input value={tipTo} onChange={(e) => setTipTo(e.target.value)} />
            <Label className="mt-2">PAS</Label>
            <Input value={tipAmt} onChange={(e) => setTipAmt(e.target.value)} />
            <Button
              className="mt-2"
              size="sm"
              disabled={busy || !selected || !session}
              onClick={() =>
                run(async () => {
                  await portalTip(
                    selected as Address,
                    tipTo as Address,
                    tipAmt,
                    session
                  );
                  setMsg("Tip ok");
                })
              }
            >
              tip
            </Button>
          </Card>
          <Card>
            <CardTitle>Contribute</CardTitle>
            <FieldHint>80% nodo / 20% protocolo. Monto = campo Tip.</FieldHint>
            <Button
              className="mt-2"
              size="sm"
              disabled={busy || !selected || !session}
              onClick={() =>
                run(async () => {
                  await portalContribute(selected as Address, tipAmt, session);
                  setMsg("Contribute ok");
                })
              }
            >
              contribute
            </Button>
          </Card>
          <Card>
            <CardTitle>Disolver</CardTitle>
            <Button
              className="mt-2"
              size="sm"
              variant="destructive"
              disabled={busy || !selected || !session}
              onClick={() =>
                run(async () => {
                  if (!window.confirm("¿Disolver nodo?")) return;
                  await portalDissolveNode(
                    selected as Address,
                    session!.address,
                    undefined,
                    session
                  );
                  setSelected("");
                  setMsg("Disuelto");
                })
              }
            >
              dissolve
            </Button>
          </Card>
        </div>
      )}

      <Card>
        <CardTitle>Crear nodo</CardTitle>
        <CardDesc>Quedas como gobernanza. Seed 100% al tesoro del nodo.</CardDesc>
        <Label className="mt-3">Nombre</Label>
        <Input value={nodeName} onChange={(e) => setNodeName(e.target.value)} />
        <Label className="mt-2">Seed (PAS)</Label>
        <Input value={seedAmt} onChange={(e) => setSeedAmt(e.target.value)} />
        <Label className="mt-2">reserveFloor (PAS)</Label>
        <Input
          value={reserveFloor}
          onChange={(e) => setReserveFloor(e.target.value)}
        />
        <FieldHint>
          reserveFloor: piso que harvest no toca. Seed ≠ contribute (no hay
          split 80/20).
        </FieldHint>
        <Button
          className="mt-3"
          disabled={busy || !session}
          onClick={() =>
            run(async () => {
              const r = await portalCreateNode(nodeName, session, {
                seedEther: seedAmt,
                reserveFloorEther: reserveFloor,
              });
              selectAsActive({
                address: r.node,
                name: r.name,
                memberCount: 1n,
              });
              setMsg(`Creado ${r.name}`);
            })
          }
        >
          Crear y usar
        </Button>
      </Card>

      {(msg || err) && (
        <p
          className={`mt-4 text-sm ${err ? "text-[var(--color-danger)]" : "text-[var(--color-moss)]"}`}
        >
          {err || msg}
        </p>
      )}
    </div>
  );
}
