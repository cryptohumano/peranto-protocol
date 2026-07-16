import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { Heart, Loader2, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  connectAura,
  getReadClient,
  portalListMembershipNodes,
  portalTip,
} from "@/lib/client";
import {
  loadSession,
  saveSession,
  type SessionIdentity,
} from "@/lib/session";
import {
  buildPublicPageShareUrl,
  DEFAULT_TIP_AMT,
  TIP_AMOUNT_PRESETS,
} from "@/lib/public-page";
import { formatDid } from "@peranto/sdk";
import type { Address } from "viem";
import { shortAddr, cn } from "@/lib/utils";

type MemberNode = {
  address: Address;
  name: string;
  memberCount: bigint;
};

type Props = {
  profileAddress: Address;
  handle: string | null;
  /** Path ref used in the URL, e.g. @edo or did */
  pageRef: string;
  /** Owner-preferred DisCO (from PerantoPage). */
  preferredNode?: Address;
  /** Owner-suggested default tip (PAS). */
  defaultAmt?: string;
};

function normalizeAmt(raw: string | null | undefined, fallback: string): string {
  const t = (raw ?? "").trim();
  if (t && /^\d+(\.\d+)?$/.test(t) && Number(t) > 0) return t;
  return fallback;
}

export function PublicLoveInvite({
  profileAddress,
  handle,
  pageRef,
  preferredNode,
  defaultAmt,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tipOpen = searchParams.get("tip") === "1";
  const ownerDefault = normalizeAmt(defaultAmt, DEFAULT_TIP_AMT);

  const [session, setSession] = useState<SessionIdentity | null>(null);
  const [nodes, setNodes] = useState<MemberNode[]>([]);
  const [node, setNode] = useState<Address | "">("");
  const [amt, setAmt] = useState(ownerDefault);
  const [customAmt, setCustomAmt] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const who = handle ? `@${handle}` : shortAddr(profileAddress);

  const tipUrl = useMemo(() => {
    const base = buildPublicPageShareUrl(pageRef);
    const u = new URL(base);
    const hash = u.hash || `#/u/${encodeURIComponent(pageRef)}`;
    const [path, existingQs] = hash.replace(/^#/, "").split("?");
    const qs = new URLSearchParams(existingQs || "");
    qs.set("tip", "1");
    if (node) qs.set("node", node);
    qs.set("amt", amt);
    u.hash = `${path}?${qs.toString()}`;
    return u.toString();
  }, [pageRef, node, amt]);

  useEffect(() => {
    setSession(loadSession());
    const onSession = (ev: Event) => {
      setSession(
        (ev as CustomEvent<SessionIdentity | null>).detail ?? loadSession()
      );
    };
    window.addEventListener("peranto:session", onSession);
    return () => window.removeEventListener("peranto:session", onSession);
  }, []);

  useEffect(() => {
    const fromQs = normalizeAmt(searchParams.get("amt"), ownerDefault);
    setAmt(fromQs);
    if (!(TIP_AMOUNT_PRESETS as readonly string[]).includes(fromQs)) {
      setCustomAmt(fromQs);
    }
  }, [searchParams, ownerDefault]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingNodes(true);
      try {
        const list = await portalListMembershipNodes(profileAddress);
        if (cancelled) return;
        setNodes(list);
        const fromQs = searchParams.get("node") as Address | null;
        const pref =
          preferredNode &&
          list.find(
            (n) => n.address.toLowerCase() === preferredNode.toLowerCase()
          )?.address;
        const pick =
          (fromQs &&
            list.find((n) => n.address.toLowerCase() === fromQs.toLowerCase())
              ?.address) ||
          pref ||
          list[0]?.address ||
          "";
        setNode(pick);
      } catch {
        if (!cancelled) setNodes([]);
      } finally {
        if (!cancelled) setLoadingNodes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileAddress, preferredNode, searchParams]);

  useEffect(() => {
    if (!nodes.length || !tipUrl) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(tipUrl, {
      width: 200,
      margin: 1,
      color: { dark: "#14221c", light: "#f3efe6" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [tipUrl, nodes.length]);

  function setAmtAndQs(nextAmt: string) {
    const v = normalizeAmt(nextAmt, ownerDefault);
    setAmt(v);
    if (tipOpen) {
      const next = new URLSearchParams(searchParams);
      next.set("amt", v);
      setSearchParams(next, { replace: true });
    }
  }

  function openTipSheet() {
    const next = new URLSearchParams(searchParams);
    next.set("tip", "1");
    if (node) next.set("node", node);
    next.set("amt", amt);
    setSearchParams(next, { replace: true });
  }

  function closeTipSheet() {
    const next = new URLSearchParams(searchParams);
    next.delete("tip");
    next.delete("amt");
    setSearchParams(next, { replace: true });
    setMsg("");
    setErr("");
  }

  async function connectWallet() {
    setBusy(true);
    setErr("");
    try {
      const accounts = await connectAura();
      if (!accounts[0]) throw new Error("Sin cuentas Aura");
      const s: SessionIdentity = {
        address: accounts[0] as Address,
        did: formatDid("paseo", accounts[0] as Address),
        source: "aura",
      };
      saveSession(s);
      setSession(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmLove() {
    if (!session || !node) return;
    if (session.address.toLowerCase() === profileAddress.toLowerCase()) {
      setErr(
        "No puedes darte Love/Care a ti mismo — pide a otra persona que tipée."
      );
      return;
    }
    const tipAmt = normalizeAmt(amt, ownerDefault);
    if (!(Number(tipAmt) > 0)) {
      setErr("Monto inválido");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await portalTip(node as Address, profileAddress, tipAmt, session);
      setMsg(`Love enviado a ${who} (${tipAmt} PAS). Tú ganaste Care.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const isSelf =
    !!session &&
    session.address.toLowerCase() === profileAddress.toLowerCase();

  const ownerLockedNode =
    preferredNode &&
    nodes.some(
      (n) => n.address.toLowerCase() === preferredNode.toLowerCase()
    );

  if (loadingNodes) {
    return (
      <div className="mt-10 flex justify-center text-[#f3efe6]/40">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (nodes.length === 0) return null;

  const amountPicker = (
    <div className="mt-4 w-full max-w-xs">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f3efe6]/45">
        Monto (PAS)
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {TIP_AMOUNT_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setCustomAmt("");
              setAmtAndQs(p);
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs tabular-nums transition",
              amt === p && !customAmt
                ? "border-[#c4a35a] bg-[#c4a35a]/20 text-[#f3efe6]"
                : "border-white/15 text-[#f3efe6]/65 hover:border-white/30"
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="decimal"
        placeholder="Otro monto…"
        value={customAmt}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          setCustomAmt(v);
          if (v && /^\d+(\.\d+)?$/.test(v) && Number(v) > 0) {
            setAmtAndQs(v);
          }
        }}
        className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-center text-sm tabular-nums text-[#f3efe6] placeholder:text-[#f3efe6]/30"
      />
      <p className="mt-1.5 text-[10px] text-[#f3efe6]/35">
        El monto no cambia el +1 Care/Love — solo el PAS transferido
      </p>
    </div>
  );

  return (
    <>
      <section className="mt-10 flex flex-col items-center text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#c4a35a]/90">
          Apoyar con Love
        </p>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-[#f3efe6]/65">
          Escanea el QR con tu teléfono — abre este linktr33 para dar{" "}
          <strong className="text-[#f3efe6]/85">Love</strong> a {who} (tú
          ganas <strong className="text-[#f3efe6]/85">Care</strong>).
        </p>

        {ownerLockedNode ? (
          <p className="mt-3 text-[11px] text-[#f3efe6]/40">
            vía{" "}
            {nodes.find(
              (n) => n.address.toLowerCase() === preferredNode!.toLowerCase()
            )?.name || shortAddr(preferredNode!)}
          </p>
        ) : nodes.length > 1 ? (
          <select
            className="mt-4 w-full max-w-xs rounded-xl border border-white/15 bg-[#14221c]/80 px-3 py-2 text-sm text-[#f3efe6]"
            value={node}
            onChange={(e) => {
              const v = e.target.value as Address;
              setNode(v);
              if (tipOpen) {
                const next = new URLSearchParams(searchParams);
                next.set("node", v);
                setSearchParams(next, { replace: true });
              }
            }}
            aria-label="DisCO"
          >
            {nodes.map((n) => (
              <option key={n.address} value={n.address}>
                vía {n.name || shortAddr(n.address)}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-3 text-[11px] text-[#f3efe6]/40">
            vía {nodes[0].name || shortAddr(nodes[0].address)}
          </p>
        )}

        {qrDataUrl ? (
          <div className="mt-5 rounded-2xl bg-[#f3efe6] p-3 shadow-lg shadow-black/30">
            <img
              src={qrDataUrl}
              alt={`QR para dar Love a ${who} — escanear con el teléfono`}
              width={180}
              height={180}
              className="rounded-lg"
            />
          </div>
        ) : (
          <div className="mt-5 size-[180px] animate-pulse rounded-2xl bg-white/10" />
        )}

        <p className="mt-3 max-w-[14rem] text-[10px] leading-snug text-[#f3efe6]/40">
          Escanea el QR (abre el tip en el teléfono). En este dispositivo usa el
          enlace de abajo.
        </p>

        <button
          type="button"
          onClick={openTipSheet}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c4a35a] underline-offset-2 hover:underline"
        >
          <Heart className="size-3.5" />
          Toca para dar Love · {amt} PAS
        </button>
      </section>

      {tipOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTipSheet();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="love-sheet-title"
            className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#14221c] p-5 text-[#f3efe6] shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2
                  id="love-sheet-title"
                  className="font-display text-lg font-bold"
                >
                  Dar Love a {who}
                </h2>
                <p className="mt-1 text-xs text-[#f3efe6]/55">
                  Confirma en tu wallet. Tú recibes Care; {who} recibe Love.
                </p>
              </div>
              <button
                type="button"
                onClick={closeTipSheet}
                className="rounded-lg p-1 text-[#f3efe6]/50 hover:bg-white/10 hover:text-[#f3efe6]"
                aria-label="Cerrar"
              >
                <X className="size-4" />
              </button>
            </div>

            {!ownerLockedNode && nodes.length > 1 && (
              <select
                className="mt-4 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm"
                value={node}
                onChange={(e) => {
                  const v = e.target.value as Address;
                  setNode(v);
                  const next = new URLSearchParams(searchParams);
                  next.set("node", v);
                  setSearchParams(next, { replace: true });
                }}
              >
                {nodes.map((n) => (
                  <option key={n.address} value={n.address}>
                    {n.name || shortAddr(n.address)}
                  </option>
                ))}
              </select>
            )}
            {ownerLockedNode && (
              <p className="mt-3 text-[11px] text-[#f3efe6]/45">
                DisCO fijo por el dueño:{" "}
                {nodes.find(
                  (n) =>
                    n.address.toLowerCase() === preferredNode!.toLowerCase()
                )?.name || shortAddr(preferredNode!)}
              </p>
            )}

            <div className="mt-3">{amountPicker}</div>

            {!session ? (
              <div className="mt-4 space-y-2">
                <Button
                  className="w-full bg-[#c4a35a] text-[#14221c] hover:bg-[#d4b56a]"
                  disabled={busy}
                  onClick={() => void connectWallet()}
                >
                  <Wallet className="size-3.5" />
                  Conectar Aura
                </Button>
                <Link
                  to="/login"
                  className="block text-center text-[11px] text-[#c4a35a] underline-offset-2 hover:underline"
                >
                  O entrar al portal
                </Link>
              </div>
            ) : isSelf ? (
              <p className="mt-4 rounded-xl border border-[#c4a35a]/30 bg-[#c4a35a]/10 px-3 py-3 text-xs leading-relaxed text-[#f3efe6]/80">
                Esta es tu página. Love y Care miden reconocimiento{" "}
                <em>entre peers</em> — no puedes tiparte a ti mismo. Comparte el
                QR con alguien de tu DisCO.
              </p>
            ) : (
              <Button
                className="mt-4 w-full"
                disabled={busy || !node}
                onClick={() => void confirmLove()}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Heart className="size-3.5" />
                )}
                Confirmar Love · {amt} PAS
              </Button>
            )}

            {(msg || err) && (
              <p
                className={`mt-3 text-xs ${err ? "text-[#e8a0a0]" : "text-[#9dcfb5]"}`}
              >
                {err || msg}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function PublicVertexStats({
  profileAddress,
}: {
  profileAddress: Address;
}) {
  const [stats, setStats] = useState<{
    love: string;
    care: string;
    livelihood: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = await getReadClient();
        const agg = await client.aggregateMemberScores(profileAddress);
        if (cancelled) return;
        if (agg.nodes.length === 0) {
          setStats(null);
          return;
        }
        setStats({
          love: String(agg.love),
          care: String(agg.care),
          livelihood: String(agg.livelihood),
        });
      } catch {
        if (!cancelled) setStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileAddress]);

  if (!stats) return null;

  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      {[
        { k: "Love", v: stats.love },
        { k: "Care", v: stats.care },
        { k: "Livelihood", v: stats.livelihood },
      ].map((s) => (
        <span
          key={s.k}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-[#f3efe6]/75"
        >
          <span className="text-[#c4a35a]">{s.k}</span>{" "}
          <span className="font-semibold tabular-nums text-[#f3efe6]">
            {s.v}
          </span>
        </span>
      ))}
    </div>
  );
}
