import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import type { ActivityTx } from "@peranto/sdk";
import { isAddress, type Address } from "viem";
import { BookUser, MessageCircle, Send, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldHint, HelpCallout } from "@/components/HelpCallout";
import { loadSession } from "@/lib/session";
import {
  loadCachedActivity,
  recordLocalNativeTransfer,
  syncUserActivity,
} from "@/lib/activity-sync";
import { activityColumns } from "@/components/transactions/columns";
import { ActivityDataTable } from "@/components/transactions/data-table";
import { ContactLinksSheet } from "@/components/ContactLinksSheet";
import {
  loadAddressBook,
  removeAddressBookEntry,
  upsertAddressBookEntry,
  type AddressBookEntry,
} from "@/lib/address-book";
import { getReadClient, portalResolveIdentityRef, portalSendNative } from "@/lib/client";
import { formatPas } from "@/lib/format";
import { shortAddr } from "@/lib/utils";
import { parseEther } from "viem";

export function ActivityPage() {
  const session = loadSession();
  const [tab, setTab] = useState("history");
  const [rows, setRows] = useState<ActivityTx[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [meta, setMeta] = useState<{
    added: number;
    fromCache: number;
    lastBlock: string;
    syncedAt: string;
  } | null>(null);

  const [book, setBook] = useState<AddressBookEntry[]>(() => loadAddressBook());
  const [walletWei, setWalletWei] = useState<bigint | null>(null);

  const [toAddr, setToAddr] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [saveAfter, setSaveAfter] = useState(true);
  const [saveLabel, setSaveLabel] = useState("");

  const [abLabel, setAbLabel] = useState("");
  const [abAddress, setAbAddress] = useState("");
  const [abNote, setAbNote] = useState("");

  const [contactSheet, setContactSheet] = useState<AddressBookEntry | null>(
    null
  );

  const refreshBook = useCallback(() => {
    setBook(loadAddressBook());
  }, []);

  const refresh = useCallback(async (forceFullLookback = false) => {
    const s = loadSession();
    if (!s) return;
    setBusy(true);
    setErr("");
    try {
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

      const client = await getReadClient();
      const bal = await client.publicClient.getBalance({ address: s.address });
      setWalletWei(bal);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onBook = () => refreshBook();
    window.addEventListener("peranto:addressBook", onBook);
    return () => window.removeEventListener("peranto:addressBook", onBook);
  }, [refresh, refreshBook]);

  if (!session) return <Navigate to="/login" replace />;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      await refresh(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
            Transacciones
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink)]/70">
            Historial on-chain, envío de PAS entre direcciones y libreta de
            contactos guardados en este navegador.
          </p>
          {walletWei !== null && (
            <p className="mt-2 text-sm text-[var(--color-moss)]">
              Saldo wallet: <strong>{formatPas(walletWei)} PAS</strong>
            </p>
          )}
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

      {(err || msg) && (
        <p
          className={`mb-4 text-sm ${err ? "text-[var(--color-danger)]" : "text-[var(--color-moss)]"}`}
        >
          {err || msg}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="history" className="rounded-full gap-1.5">
            <List className="size-3.5" />
            Historial
          </TabsTrigger>
          <TabsTrigger value="send" className="rounded-full gap-1.5">
            <Send className="size-3.5" />
            Enviar
          </TabsTrigger>
          <TabsTrigger value="book" className="rounded-full gap-1.5">
            <BookUser className="size-3.5" />
            Libreta
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-0">
          <ActivityDataTable columns={activityColumns} data={rows} />
        </TabsContent>

        <TabsContent value="send" className="mt-0 space-y-3">
          <HelpCallout title="Transferencia nativa">
            <p>
              Envía PAS desde tu sesión actual a cualquier address EVM. No es un
              tip DisCO (no mueve Love/Care): es un envío simple de valor.
            </p>
          </HelpCallout>
          <Card>
            <CardTitle>Enviar PAS</CardTitle>
            <CardDesc>
              Desde {shortAddr(session.address)}
              {session.displayName ? ` (@${session.displayName})` : ""}
            </CardDesc>
            <Label className="mt-3">Destino (0x…, DID o @nombre)</Label>
            <Input
              value={toAddr}
              onChange={(e) => setToAddr(e.target.value)}
              placeholder="0x… · did:peranto:… · @alice"
            />
            <FieldHint>
              Si pegas un @nombre, se resuelve vía NameRegistry antes de enviar.
            </FieldHint>
            {book.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {book.slice(0, 12).map((e) => (
                  <Button
                    key={e.id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setToAddr(e.address);
                      setSaveLabel(e.label);
                    }}
                  >
                    {e.label}
                  </Button>
                ))}
              </div>
            )}
            <Label className="mt-3">Monto (PAS)</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.1"
            />
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveAfter}
                onChange={(e) => setSaveAfter(e.target.checked)}
              />
              Guardar destino en libreta
            </label>
            {saveAfter && (
              <>
                <Label className="mt-2">Etiqueta</Label>
                <Input
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                  placeholder="Alice / attester-lab…"
                />
              </>
            )}
            <Button
              className="mt-4"
              disabled={busy || !toAddr.trim() || !amount.trim()}
              onClick={() =>
                run(async () => {
                  const raw = toAddr.trim();
                  let to: Address;
                  let bookLabel = saveLabel;
                  if (isAddress(raw)) {
                    to = raw as Address;
                  } else {
                    const resolved = await portalResolveIdentityRef(raw);
                    to = resolved.address;
                    if (!bookLabel && resolved.label) bookLabel = `@${resolved.label}`;
                    setMsg(`Resuelto ${raw} → ${shortAddr(to)}`);
                  }
                  const valueWei = parseEther(amount.trim());
                  const tx = await portalSendNative(to, amount.trim(), session);
                  let blockNumber = 0n;
                  try {
                    const client = await getReadClient();
                    const receipt = await client.publicClient.waitForTransactionReceipt({
                      hash: tx,
                    });
                    blockNumber = receipt.blockNumber ?? 0n;
                  } catch {
                    /* ignore */
                  }
                  await recordLocalNativeTransfer({
                    account: session.address,
                    direction: "send",
                    txHash: tx,
                    counterpart: to,
                    valueWei,
                    blockNumber,
                  });
                  if (saveAfter) {
                    upsertAddressBookEntry({
                      address: to,
                      label: bookLabel || shortAddr(to),
                    });
                    refreshBook();
                  }
                  setMsg(`Enviado · tx ${tx}`);
                  setTab("history");
                  await refresh(false);
                })
              }
            >
              Enviar
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="book" className="mt-0 space-y-3">
          <Card>
            <CardTitle>Añadir contacto</CardTitle>
            <CardDesc>
              Libreta local (este navegador). Útil para tips, VCs y transferencias.
            </CardDesc>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Etiqueta</Label>
                <Input
                  value={abLabel}
                  onChange={(e) => setAbLabel(e.target.value)}
                  placeholder="member-alice"
                />
              </div>
              <div>
                <Label>Address</Label>
                <Input
                  value={abAddress}
                  onChange={(e) => setAbAddress(e.target.value)}
                  placeholder="0x…"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Nota (opcional)</Label>
                <Input
                  value={abNote}
                  onChange={(e) => setAbNote(e.target.value)}
                  placeholder="Faucet smoke / lab…"
                />
              </div>
            </div>
            <FieldHint className="mt-2">
              Tras fondear las cuentas smoke, pégalas aquí con sus roles.
            </FieldHint>
            <Button
              className="mt-3"
              size="sm"
              disabled={busy || !abAddress.trim()}
              onClick={() => {
                try {
                  upsertAddressBookEntry({
                    address: abAddress.trim(),
                    label: abLabel.trim() || "contacto",
                    note: abNote.trim() || undefined,
                  });
                  setAbLabel("");
                  setAbAddress("");
                  setAbNote("");
                  refreshBook();
                  setMsg("Contacto guardado");
                  setErr("");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Guardar en libreta
            </Button>
          </Card>

          <Card>
            <CardTitle>Contactos ({book.length})</CardTitle>
            {book.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink)]/55">
                Vacía. Añade addresses para reutilizarlas al enviar.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {book.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-moss)]/12 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--color-moss-deep)]">
                        {e.label}
                      </p>
                      <p className="truncate font-mono text-[10px] text-[var(--color-ink)]/45">
                        {e.address}
                      </p>
                      {e.note && (
                        <p className="text-[11px] text-[var(--color-ink)]/55">
                          {e.note}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(e.links?.length ?? 0) > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setContactSheet(e)}
                        >
                          <MessageCircle className="size-3.5" />
                          Contactar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setToAddr(e.address);
                          setSaveLabel(e.label);
                          setTab("send");
                        }}
                      >
                        <Send className="size-3.5" />
                        Enviar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(e.address);
                          setMsg("Address copiada");
                        }}
                      >
                        Copiar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          removeAddressBookEntry(e.id);
                          refreshBook();
                        }}
                      >
                        Quitar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ContactLinksSheet
            open={contactSheet !== null}
            onOpenChange={(open) => {
              if (!open) setContactSheet(null);
            }}
            label={contactSheet?.label ?? ""}
            shareUrl={contactSheet?.shareUrl}
            links={contactSheet?.links ?? []}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
