import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  IdentityDashboard,
  type Belonging,
} from "@/components/IdentityDashboard";
import {
  loadSession,
  saveSession,
  knownNamesFor,
  rememberName,
  type SessionIdentity,
} from "@/lib/session";
import {
  fetchAuraVault,
  getReadClient,
  portalRegisterName,
  portalReleaseName,
  portalResolveDid,
  portalResolveIdentityRef,
  portalSetDidService,
  portalClearDidService,
  portalAddDidDelegate,
  portalRevokeDidDelegate,
  portalAuraHasMnemonic,
  portalPublishPurposeKeys,
  saveJwtToVault,
  vault,
} from "@/lib/client";
import { deriveServiceSlot } from "@/lib/public-page";
import {
  isValidNameLabel,
  nameLabelError,
  normalizeNameLabel,
} from "@/lib/name-label";
import { shortAddr, cn } from "@/lib/utils";
import { FieldHint, HelpCallout } from "@/components/HelpCallout";
import { VaultCredentialCard } from "@/components/VaultCredentialCard";
import { upsertAddressBookEntry } from "@/lib/address-book";
import {
  DELEGATE_TYPE_SVC,
  DELEGATE_TYPE_SIG_AUTH,
  DELEGATE_TYPE_VERI_KEY,
  type DidDocument,
  type DidService,
  type VaultCredential,
} from "@peranto/sdk";
import { isAddress, type Address, type Hex } from "viem";

const STATUS = ["None", "Active", "Revoked"];
const SVC_PRESETS = [
  { type: "LinkedDomains", hint: "Dominio / sitio web público" },
  { type: "CredentialInbox", hint: "Dónde recibir solicitudes de VC" },
  { type: "AuraInbox", hint: "Canal Aura / mensajería" },
  { type: "Website", hint: "Página del proyecto" },
] as const;

const DELEGATE_TYPES = [
  {
    id: DELEGATE_TYPE_SVC,
    label: "svc",
    hint: "Puede actualizar did/svc/* (capabilityInvocation)",
  },
  {
    id: DELEGATE_TYPE_SIG_AUTH,
    label: "sigAuth",
    hint: "Aparece en authentication del Document",
  },
  {
    id: DELEGATE_TYPE_VERI_KEY,
    label: "veriKey",
    hint: "Aparece en assertionMethod del Document",
  },
] as const;

export function IdentityPage() {
  const [session, setSession] = useState<SessionIdentity | null>(null);
  const [creds, setCreds] = useState<VaultCredential[]>([]);
  const [walletWei, setWalletWei] = useState<bigint | null>(null);
  const [belongings, setBelongings] = useState<Belonging[]>([]);
  const [anchors, setAnchors] = useState<
    Array<{ credHash: Hex; schemaId: Hex; attester: Address; subject: Address }>
  >([]);
  const [services, setServices] = useState<DidService[]>([]);
  const [attesterOk, setAttesterOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState("overview");
  const [name, setName] = useState("");
  const [svcType, setSvcType] = useState("LinkedDomains");
  const [svcKey, setSvcKey] = useState("");
  const [svcEndpoint, setSvcEndpoint] = useState("");
  const [delegateAddr, setDelegateAddr] = useState("");
  const [delegateType, setDelegateType] = useState<string>(DELEGATE_TYPE_SVC);
  const [delegateDays, setDelegateDays] = useState("365");
  const [didDoc, setDidDoc] = useState<DidDocument | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [importJwt, setImportJwt] = useState("");
  const [lookupName, setLookupName] = useState("");
  const [lookupResult, setLookupResult] = useState<{
    label: string;
    address: Address;
    did: string;
  } | null>(null);
  const [foreignDidDoc, setForeignDidDoc] = useState<DidDocument | null>(null);

  // Aura guarda el mnemonic en la extensión: el portal nunca lo tiene, así que
  // hay que preguntarle si puede derivar (`null` = build antiguo, no bloquear).
  const [auraHasMnemonic, setAuraHasMnemonic] = useState<boolean | null>(null);
  const usesAura = session?.source === "aura";
  const canPublishPurposeKeys =
    Boolean(session?.mnemonic) || (usesAura && auraHasMnemonic !== false);

  useEffect(() => {
    if (!usesAura) {
      setAuraHasMnemonic(null);
      return;
    }
    let alive = true;
    portalAuraHasMnemonic().then((has) => {
      if (alive) setAuraHasMnemonic(has);
    });
    return () => {
      alive = false;
    };
  }, [usesAura]);

  const refresh = useCallback(async () => {
    const s = loadSession();
    setSession(s);
    if (!s) return;
    const local = await vault.list();
    const aura = await fetchAuraVault();
    const merged = [...local];
    for (const a of aura) {
      if (!merged.find((m) => m.id === a.id)) merged.push(a);
      await vault.put(a);
    }
    setCreds(
      merged.filter(
        (c) =>
          c.subjectDid.toLowerCase().includes(s.address.slice(2).toLowerCase()) ||
          c.subjectDid === s.did
      )
    );

    try {
      const client = await getReadClient();
      const list = await client.queryCredentialAnchors({ subject: s.address });
      setAnchors(list);
      const hints = [
        ...(s.displayName ? [s.displayName] : []),
        ...knownNamesFor(s.address),
      ];
      const primary = await client.getPrimaryName(s.address, hints);
      if (primary && primary !== s.displayName) {
        rememberName(s.address, primary);
        const next = { ...s, displayName: primary };
        saveSession(next);
        setSession(next);
      }
      const holdings = await client.getHoldings(s.address);
      setWalletWei(holdings.walletWei);
      setBelongings(
        holdings.nodes.map((n) => ({
          name: n.name,
          address: n.address,
          balanceWei: n.balanceWei,
          role: n.role,
        }))
      );

      try {
        // Same path as /page — warm sync + recent merge (not bare SDK cold lookback).
        const doc = await portalResolveDid(s.did);
        setDidDoc(doc);
        setServices(doc.service ?? []);
      } catch {
        setServices([]);
      }

      try {
        const ok = await client.isAuthorized(s.address, "peranto:Member:v1");
        setAttesterOk(ok);
      } catch {
        setAttesterOk(null);
      }
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!session && loadSession() === null) {
    return <Navigate to="/login" replace />;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Lookups that must not overwrite session DID/services via refresh. */
  async function runLookup(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setLookupResult(null);
      setForeignDidDoc(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const nameErr = name ? nameLabelError(name) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {session && (
        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          <TabsList className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            <TabsTrigger
              value="overview"
              className="rounded-full border border-transparent data-[state=active]:border-[var(--color-moss)]/25 data-[state=active]:bg-[var(--color-moss)]/10"
            >
              Vista
            </TabsTrigger>
            <TabsTrigger value="vault" className="rounded-full">
              Vault
            </TabsTrigger>
            <TabsTrigger value="anchors" className="rounded-full">
              Anclas
            </TabsTrigger>
            <TabsTrigger value="name" className="rounded-full">
              Nombre
            </TabsTrigger>
            <TabsTrigger value="did" className="rounded-full">
              DID
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <IdentityDashboard
              displayName={session.displayName ?? undefined}
              did={session.did}
              address={session.address}
              source={session.source}
              walletWei={walletWei}
              belongings={belongings}
              creds={creds}
              anchors={anchors}
              services={services}
              attesterOk={attesterOk}
              onOpenTools={(t) => setTab(t)}
            />
          </TabsContent>

          <TabsContent value="vault" className="mt-0 space-y-3">
            <Card>
              <CardTitle>Credenciales (JWT)</CardTitle>
              <CardDesc>IndexedDB local + sync Aura si está disponible.</CardDesc>
              {creds.length === 0 && (
                <p className="mt-3 text-sm text-[var(--color-ink)]/60">Vacío.</p>
              )}
              <ul className="mt-3 space-y-2">
                {creds.map((c) => (
                  <VaultCredentialCard
                    key={c.id}
                    cred={c}
                    onVerify={() =>
                      run(async () => {
                        const client = await getReadClient();
                        const v = await client.verifyCredential(c.jwt);
                        setMsg(
                          `JWT ${v.jwtValid ? "ok" : "fail"} · chain ${STATUS[v.onChainStatus]} · auth ${v.authorized}`
                        );
                      })
                    }
                  />
                ))}
              </ul>
              <div className="mt-4">
                <Label>Importar JWT</Label>
                <Textarea
                  value={importJwt}
                  onChange={(e) => setImportJwt(e.target.value)}
                  placeholder="eyJhbGciOi…"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !importJwt.trim()}
                    onClick={() =>
                      run(async () => {
                        const client = await getReadClient();
                        const v = await client.verifyCredential(importJwt.trim());
                        if (!v.jwtValid) throw new Error(v.details.error ?? "JWT inválido");
                        await saveJwtToVault({
                          jwt: importJwt.trim(),
                          credHash: v.details.credHash,
                          schemaKey:
                            ((v.details.vc.credentialSchema as { id?: string } | undefined)?.id) ??
                            "unknown",
                          subjectDid: v.details.subjectDid,
                          issuerDid: v.details.issuerDid,
                        });
                        setImportJwt("");
                        setMsg("JWT guardado en vault");
                      })
                    }
                  >
                    Guardar
                  </Button>
                  <Link
                    to="/credentials"
                    className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                  >
                    Solicitar / emitir
                  </Link>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="anchors" className="mt-0">
            <Card>
              <CardTitle>Anclas on-chain</CardTitle>
              <CardDesc>
                Solo hash + schema + subject + attester + status (sin claims).
              </CardDesc>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => run(refresh)}
              >
                Refrescar
              </Button>
              <ul className="mt-3 space-y-2 text-sm">
                {anchors.map((a) => (
                  <li key={a.credHash} className="border-b border-[var(--color-moss)]/10 py-2">
                    <code className="text-[10px]">{a.credHash}</code>
                    <p className="text-xs text-[var(--color-ink)]/60">
                      attester {shortAddr(a.attester)}
                    </p>
                  </li>
                ))}
                {anchors.length === 0 && (
                  <p className="text-[var(--color-ink)]/55">Sin anclas para esta address.</p>
                )}
              </ul>
            </Card>
          </TabsContent>

          <TabsContent value="name" className="mt-0 space-y-3">
            <Card>
              <CardTitle>Resolver @nombre → DID</CardTitle>
              <CardDesc>
                NameRegistry mapea el handle a una address; el DID es{" "}
                <code className="text-[10px]">did:peranto:paseo:0x…</code>.
              </CardDesc>
              <Label className="mt-3">Nombre o @handle</Label>
              <Input
                value={lookupName}
                onChange={(e) => setLookupName(e.target.value)}
                placeholder="@alice o alice"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !lookupName.trim()}
                  onClick={() =>
                    runLookup(async () => {
                      setLookupResult(null);
                      setForeignDidDoc(null);
                      const r = await portalResolveIdentityRef(lookupName.trim());
                      setLookupResult({
                        label: r.label ?? (r.kind === "name" ? "—" : r.kind),
                        address: r.address,
                        did: r.did,
                      });
                      setForeignDidDoc(null);
                      setMsg(
                        r.kind === "name"
                          ? `@${r.label} → ${r.did}`
                          : `Resuelto → ${r.did}`
                      );
                    })
                  }
                >
                  Resolver
                </Button>
                {lookupResult && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        runLookup(async () => {
                          const doc = await portalResolveDid(lookupResult.did, {
                            useCache: false,
                          });
                          setForeignDidDoc(doc);
                          setMsg(
                            `Documento de ${lookupResult.did.slice(0, 28)}…`
                          );
                        })
                      }
                    >
                      Ver documento DID
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        upsertAddressBookEntry({
                          address: lookupResult.address,
                          label: lookupResult.label.startsWith("@")
                            ? lookupResult.label
                            : lookupResult.label === "address" ||
                                lookupResult.label === "did"
                              ? shortAddr(lookupResult.address)
                              : `@${lookupResult.label}`,
                          note: lookupResult.did,
                        });
                        setMsg("Guardado en libreta de Transacciones");
                      }}
                    >
                      Guardar en libreta
                    </Button>
                  </>
                )}
              </div>
              {lookupResult && (
                <div className="mt-3 space-y-1 rounded-xl border border-[var(--color-moss)]/12 bg-[var(--color-mist)]/30 px-3 py-2 text-sm">
                  <p>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      Handle / ref
                    </span>{" "}
                    <strong>
                      {lookupResult.label === "address" ||
                      lookupResult.label === "did"
                        ? shortAddr(lookupResult.address)
                        : `@${lookupResult.label}`}
                    </strong>
                  </p>
                  <p className="font-mono text-[11px] break-all">
                    {lookupResult.address}
                  </p>
                  <p className="font-mono text-[11px] break-all text-[var(--color-moss)]">
                    {lookupResult.did}
                  </p>
                </div>
              )}
              {foreignDidDoc && lookupResult && (
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Documento ajeno (solo lectura) — no es tu DID
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-ink)]/50">
                    {foreignDidDoc.id ?? lookupResult.did}
                  </p>
                  {(foreignDidDoc.service?.length ?? 0) > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {foreignDidDoc.service!.map((s) => (
                        <li
                          key={s.attrKey ?? s.id}
                          className="rounded-lg bg-[var(--color-moss)]/5 px-2 py-1.5"
                        >
                          <span className="font-semibold">{s.type}</span>
                          <span className="mt-0.5 block truncate text-[var(--color-ink)]/55">
                            {typeof s.serviceEndpoint === "string"
                              ? s.serviceEndpoint
                              : JSON.stringify(s.serviceEndpoint)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <pre className="mt-2 max-h-56 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-moss)]/5 p-3 text-[10px] leading-relaxed">
                    {JSON.stringify(foreignDidDoc, null, 2)}
                  </pre>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="ghost"
                    onClick={() => setForeignDidDoc(null)}
                  >
                    Cerrar documento
                  </Button>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Registrar @nombre</CardTitle>
              <CardDesc>Fee → ProtocolTreasury. Visible on-chain.</CardDesc>
              <Label className="mt-3">Nombre</Label>
              <Input
                value={name}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="trukutu"
                onChange={(e) => setName(normalizeNameLabel(e.target.value))}
              />
              {nameErr ? (
                <p className="mt-1.5 text-xs text-red-700" role="alert">
                  {nameErr}
                </p>
              ) : (
                <FieldHint>
                  Sin @; solo [a-z0-9-], longitud 3–32; se fuerza a minúsculas.
                </FieldHint>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={busy || !isValidNameLabel(name)}
                  onClick={() =>
                    run(async () => {
                      const label = normalizeNameLabel(name);
                      const errMsg = nameLabelError(label);
                      if (errMsg) throw new Error(errMsg);
                      await portalRegisterName(label, session);
                      setMsg(`Registrado @${label}`);
                    })
                  }
                >
                  Registrar
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !session.displayName}
                  onClick={() =>
                    run(async () => {
                      await portalReleaseName(
                        session.displayName!,
                        session
                      );
                      setMsg("Nombre liberado");
                    })
                  }
                >
                  Liberar actual
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="did" className="mt-0 space-y-3">
            <HelpCallout title="Servicios DID">
              <p>
                Varios del mismo tipo con slot (<code className="text-[10px]">Type.slot</code>).
                Solo endpoints públicos — no PII en atributos.
              </p>
            </HelpCallout>
            <Card>
              <CardTitle>Publicar servicio</CardTitle>
              <div className="mt-3 flex flex-wrap gap-1">
                {SVC_PRESETS.map((p) => (
                  <Button
                    key={p.type}
                    size="sm"
                    variant={svcType === p.type ? "default" : "secondary"}
                    onClick={() => setSvcType(p.type)}
                  >
                    {p.type}
                  </Button>
                ))}
              </div>
              <FieldHint className="mt-2">
                {SVC_PRESETS.find((p) => p.type === svcType)?.hint}
              </FieldHint>
              <Label className="mt-2">Slot / id (recomendado)</Label>
              <Input
                value={svcKey}
                onChange={(e) => setSvcKey(e.target.value)}
                placeholder="web / lab / github"
              />
              <FieldHint>
                Si lo dejas vacío se deriva del endpoint (nunca se publica bare).
              </FieldHint>
              <Label className="mt-2">Endpoint</Label>
              <Input
                value={svcEndpoint}
                onChange={(e) => setSvcEndpoint(e.target.value)}
                placeholder="https://…"
              />
              <Button
                className="mt-3"
                disabled={busy || !svcEndpoint.trim()}
                onClick={() =>
                  run(async () => {
                    const endpoint = svcEndpoint.trim();
                    const slot =
                      svcKey.trim() ||
                      deriveServiceSlot(svcType, endpoint, svcKey);
                    if (!slot) {
                      throw new Error("No se pudo derivar un slot para el servicio");
                    }
                    await portalSetDidService(
                      svcType,
                      endpoint,
                      session,
                      slot
                    );
                    setMsg(`Servicio publicado (${svcType}.${slot})`);
                    setSvcEndpoint("");
                    setSvcKey("");
                  })
                }
              >
                Publicar
              </Button>
            </Card>
            <Card>
              <CardTitle>Servicios actuales</CardTitle>
              {services.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Ninguno.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {services.map((s) => (
                    <li
                      key={s.attrKey ?? s.id}
                      className="flex items-start justify-between gap-2 rounded-xl border border-[var(--color-moss)]/12 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{s.type}</p>
                        {s.attrKey && (
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {s.attrKey}
                          </p>
                        )}
                        <p className="truncate text-xs text-[var(--color-ink)]/55">
                          {typeof s.serviceEndpoint === "string"
                            ? s.serviceEndpoint
                            : JSON.stringify(s.serviceEndpoint)}
                        </p>
                      </div>
                      {s.attrKey && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await portalClearDidService(s.attrKey!, session);
                              setMsg("Servicio borrado");
                            })
                          }
                        >
                          Borrar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const doc = await portalResolveDid(session.did);
                    setDidDoc(doc);
                    setServices(doc.service ?? []);
                    setMsg("Resolve OK (solo lectura — sin transacción)");
                  })
                }
              >
                Re-resolve
              </Button>
              <FieldHint className="mt-2">
                Re-resolve solo lee la chain / sync local. No escribe ni borra
                atributos. Si falta un servicio aquí pero sigue en /page, suele
                ser lookback RPC incompleto — no una tx fantasma.
              </FieldHint>
            </Card>

            <Card>
              <CardTitle>Claves de propósito (DID v0.2.1)</CardTitle>
              <CardDesc>
                Deriva authentication / assertion / keyAgreement del mnemonic y
                las publica on-chain como{" "}
                <code className="text-[10px]">did/vm/*</code>. El controller
                (index 0) sigue pagando gas.
              </CardDesc>
              <FieldHint className="mt-2">
                Paths:{" "}
                <code className="text-[10px]">m/44&apos;/60&apos;/0&apos;/0/1</code>{" "}
                auth ·{" "}
                <code className="text-[10px]">…/2</code> assertion · URI{" "}
                <code className="text-[10px]">//did//keyAgreement//0</code> →
                X25519. Requiere mnemonic BIP39.
              </FieldHint>
              <Button
                className="mt-3"
                disabled={busy || !canPublishPurposeKeys}
                onClick={() =>
                  run(async () => {
                    const res = await portalPublishPurposeKeys(session);
                    setMsg(
                      `Claves publicadas (${res.hashes?.length ?? 3} txs)`
                    );
                    const doc = await portalResolveDid(session.did);
                    setDidDoc(doc);
                    setServices(doc.service ?? []);
                  })
                }
              >
                Publicar claves de propósito
              </Button>
              {!canPublishPurposeKeys && (
                <FieldHint className="mt-2">
                  {usesAura
                    ? "La identidad de Aura se importó con clave privada: sin mnemonic BIP39 no hay derivación. Importa tu frase en Aura, o entra con “Importar mnemonic”."
                    : "Sesión solo-EVM: importa mnemonic HD para derivar purpose keys."}
                </FieldHint>
              )}
              {usesAura && canPublishPurposeKeys && (
                <FieldHint className="mt-2">
                  Sesión Aura: la extensión deriva y firma con su propio
                  mnemonic; el portal nunca lo ve.
                </FieldHint>
              )}
              <ul className="mt-3 space-y-2 text-[11px] text-muted-foreground">
                {(didDoc?.verificationMethod ?? [])
                  .filter(
                    (vm) =>
                      vm.id.includes("#key-authentication") ||
                      vm.id.includes("#key-assertion") ||
                      vm.id.includes("#key-agreement")
                  )
                  .map((vm) => {
                    const frag = vm.id.split("#")[1] ?? vm.id;
                    const addr =
                      vm.blockchainAccountId?.split(":").pop() ??
                      (vm.publicKeyJwk
                        ? `X25519 · ${vm.publicKeyJwk.x?.slice(0, 12) ?? "…"}…`
                        : null);
                    return (
                      <li key={vm.id} className="font-mono">
                        <span className="text-foreground">{frag}</span>
                        <span className="block truncate opacity-80">
                          {addr ?? vm.type}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </Card>

            <Card>
              <CardTitle>Delegados (DID v0.2)</CardTitle>
              <CardDesc>
                Scopes: <code className="text-[10px]">svc</code> puede escribir
                servicios; <code className="text-[10px]">sigAuth</code> /{" "}
                <code className="text-[10px]">veriKey</code> enriquecen el
                Document.
              </CardDesc>
              <Label className="mt-3">Tipo</Label>
              <div className="mt-2 flex flex-wrap gap-1">
                {DELEGATE_TYPES.map((t) => (
                  <Button
                    key={t.id}
                    size="sm"
                    variant={delegateType === t.id ? "default" : "secondary"}
                    onClick={() => setDelegateType(t.id)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
              <FieldHint className="mt-2">
                {DELEGATE_TYPES.find((t) => t.id === delegateType)?.hint}
              </FieldHint>
              <Label className="mt-2">Address del delegado</Label>
              <Input
                value={delegateAddr}
                onChange={(e) => setDelegateAddr(e.target.value)}
                placeholder="0x…"
              />
              <Label className="mt-2">Validez (días)</Label>
              <Input
                value={delegateDays}
                onChange={(e) => setDelegateDays(e.target.value)}
                placeholder="365"
              />
              <Button
                className="mt-3"
                disabled={busy || !isAddress(delegateAddr.trim())}
                onClick={() =>
                  run(async () => {
                    const days = Math.max(1, Number(delegateDays) || 365);
                    const validity = BigInt(days) * 24n * 60n * 60n;
                    await portalAddDidDelegate(
                      delegateType,
                      delegateAddr.trim() as Address,
                      validity,
                      session
                    );
                    setMsg(`Delegado ${delegateType} añadido`);
                    setDelegateAddr("");
                    const doc = await portalResolveDid(session.did);
                    setDidDoc(doc);
                    setServices(doc.service ?? []);
                  })
                }
              >
                Añadir delegado
              </Button>
              <ul className="mt-3 space-y-2">
                {(didDoc?.verificationMethod ?? [])
                  .filter((vm) => vm.id.includes("#delegate-"))
                  .map((vm) => {
                    const rels: string[] = [];
                    if (didDoc?.authentication?.includes(vm.id))
                      rels.push("authentication");
                    if (didDoc?.assertionMethod?.includes(vm.id))
                      rels.push("assertionMethod");
                    if (didDoc?.capabilityInvocation?.includes(vm.id))
                      rels.push("capabilityInvocation");
                    const addrMatch = /eip155:\d+:(0x[a-fA-F0-9]{40})/.exec(
                      vm.blockchainAccountId ?? ""
                    );
                    const addr = addrMatch?.[1] as Address | undefined;
                    const typeFrag = vm.id.includes("sigAuth")
                      ? DELEGATE_TYPE_SIG_AUTH
                      : vm.id.includes("veriKey")
                        ? DELEGATE_TYPE_VERI_KEY
                        : DELEGATE_TYPE_SVC;
                    return (
                      <li
                        key={vm.id}
                        className="flex items-start justify-between gap-2 rounded-xl border border-[var(--color-moss)]/12 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold">{typeFrag}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {addr ?? vm.blockchainAccountId}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {rels.join(" · ") || "VM"}
                          </p>
                        </div>
                        {addr && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await portalRevokeDidDelegate(
                                  typeFrag,
                                  addr,
                                  session
                                );
                                setMsg("Delegado revocado");
                                const doc = await portalResolveDid(session.did);
                                setDidDoc(doc);
                                setServices(doc.service ?? []);
                              })
                            }
                          >
                            Revocar
                          </Button>
                        )}
                      </li>
                    );
                  })}
                {(didDoc?.verificationMethod ?? []).filter((vm) =>
                  vm.id.includes("#delegate-")
                ).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Ningún delegado activo en el Document.
                  </p>
                )}
              </ul>
            </Card>
            {didDoc && (
              <Card>
                <CardTitle>Documento resolve (JSON)</CardTitle>
                <pre className="mt-2 max-h-48 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-moss)]/5 p-3 text-[10px] leading-relaxed">
                  {JSON.stringify(didDoc, null, 2)}
                </pre>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}

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
