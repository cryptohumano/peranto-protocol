import { useCallback, useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import type { Address } from "viem";
import { isAddress } from "viem";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiscoContextBar } from "@/components/DiscoContextBar";
import { HelpCallout, FieldHint } from "@/components/HelpCallout";
import {
  FieldTemplateEditor,
  fieldsFromClaims,
  fieldsFromSpecs,
  fieldsToClaims,
  fieldsToSchemaBody,
  type FieldDataType,
  type FieldSpec,
  type TemplateField,
} from "@/components/FieldTemplateEditor";
import { loadSession } from "@/lib/session";
import {
  defaultOffers,
  loadActiveDisco,
  saveActiveDisco,
  type ActiveDisco,
} from "@/lib/disco";
import {
  getReadClient,
  portalIssueClaims,
  portalRegisterSchema,
  portalRevoke,
  portalStakeAndJoin,
  saveJwtToVault,
} from "@/lib/client";
import { cn, shortAddr } from "@/lib/utils";
import type { Hex } from "viem";

type ParsedRequest = {
  schemaKey: string;
  subjectAddress: string;
  subjectDid?: string;
  subjectName?: string;
  note?: string;
  claims: Record<string, unknown>;
  disco?: { name?: string; address?: string } | null;
};

type AuthStatus = "idle" | "checking" | "authorized" | "unauthorized" | "error";

function parseCredentialRequest(raw: string): ParsedRequest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("JSON inválido — pega el cuerpo completo de la solicitud");
  }
  if (!data || typeof data !== "object") throw new Error("La solicitud no es un objeto JSON");
  const o = data as Record<string, unknown>;

  const schemaKey =
    (typeof o.schemaKey === "string" && o.schemaKey) ||
    (typeof o.schema === "string" && o.schema) ||
    "";
  if (!schemaKey) throw new Error("Falta schemaKey en la solicitud");

  const subject =
    o.subject && typeof o.subject === "object"
      ? (o.subject as Record<string, unknown>)
      : {};
  const subjectAddress =
    (typeof subject.address === "string" && subject.address) ||
    (typeof o.subjectAddress === "string" && o.subjectAddress) ||
    (typeof o.subject === "string" && o.subject) ||
    "";
  if (!subjectAddress || !isAddress(subjectAddress)) {
    throw new Error("Subject sin address válida (0x…)");
  }

  const claimsRaw =
    (o.claimsHint && typeof o.claimsHint === "object" && o.claimsHint) ||
    (o.claims && typeof o.claims === "object" && o.claims) ||
    {};
  const claims = { ...(claimsRaw as Record<string, unknown>) };

  const disco =
    o.disco && typeof o.disco === "object"
      ? (o.disco as { name?: string; address?: string })
      : null;

  return {
    schemaKey,
    subjectAddress,
    subjectDid: typeof subject.did === "string" ? subject.did : undefined,
    subjectName: typeof subject.name === "string" ? subject.name : undefined,
    note: typeof o.note === "string" ? o.note : undefined,
    claims,
    disco,
  };
}

function f(
  key: string,
  dataType: FieldDataType,
  required = false
): FieldSpec {
  return { key, dataType, required };
}

const TEMPLATES: Record<
  string,
  { fields: FieldSpec[]; label: string; blurb: string }
> = {
  "peranto:Member:v1": {
    label: "Member",
    blurb: "Membresía cooperativa — identidad en el DisCO.",
    fields: [
      f("fullName", "string", true),
      f("status", "string", true),
      f("enrolledAt", "date-time", true),
      f("municipality", "string"),
      f("occupation", "string"),
      f("phone", "string"),
      f("activities", "string"),
    ],
  },
  "peranto:EcoTestResult:v1": {
    label: "EcoTestResult",
    blurb: "Resultado de eco-testing — evidencia livelihood portable.",
    fields: [
      f("sampleId", "string", true),
      f("testType", "string", true),
      f("result", "number", true),
      f("unit", "string", true),
      f("labName", "string", true),
      f("testedAt", "date-time", true),
    ],
  },
  "peranto:CommonsWork:v1": {
    label: "CommonsWork",
    blurb: "Trabajo commons documentado.",
    fields: [
      f("title", "string", true),
      f("workedAt", "date-time", true),
      f("summary", "string"),
    ],
  },
  "peranto:CareContribution:v1": {
    label: "CareContribution",
    blurb: "Aporte de cuidado (care).",
    fields: [
      f("kind", "string", true),
      f("contributedAt", "date-time", true),
      f("note", "string"),
    ],
  },
};

function typeHintsFor(schemaKey: string): Record<string, FieldDataType> {
  const t = TEMPLATES[schemaKey];
  if (!t) return {};
  return Object.fromEntries(t.fields.map((x) => [x.key, x.dataType ?? "string"]));
}

function isRegistrySchema(schemaKey: string): boolean {
  return Boolean(TEMPLATES[schemaKey]);
}

export function CredentialsPage() {
  const session = loadSession();
  const [disco, setDisco] = useState<ActiveDisco | null>(loadActiveDisco());
  const [tab, setTab] = useState("catalog");
  const [schemaKey, setSchemaKey] = useState("peranto:Member:v1");
  const [fields, setFields] = useState<TemplateField[]>(() =>
    fieldsFromSpecs(TEMPLATES["peranto:Member:v1"].fields)
  );
  const [schemaFields, setSchemaFields] = useState<TemplateField[]>(() => [
    {
      id: "new-1",
      key: "",
      value: "",
      required: true,
      dataType: "string",
    },
  ]);
  const [newSchemaKey, setNewSchemaKey] = useState("peranto:Custom:v1");
  const [subject, setSubject] = useState("");
  const [alsoMember, setAlsoMember] = useState(true);
  const [reqNote, setReqNote] = useState("");
  const [reqJson, setReqJson] = useState("");
  const [pasteRaw, setPasteRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedRequest | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [lastIssued, setLastIssued] = useState<{
    jwt: string;
    credHash: string;
    schemaKey: string;
    subject: string;
    subjectDid?: string;
  } | null>(null);
  const [lookupSubject, setLookupSubject] = useState("");
  const [anchors, setAnchors] = useState<
    Array<{
      credHash: Hex;
      attester: Address;
      subject: Address;
      status?: number;
      revokeReason?: string;
    }>
  >([]);
  const [revokeReason, setRevokeReason] = useState("actualización / reemplazo");

  const STATUS_LABEL = ["None", "Active", "Revoked"] as const;

  useEffect(() => {
    const onDisco = (ev: Event) => {
      setDisco((ev as CustomEvent<ActiveDisco | null>).detail ?? loadActiveDisco());
    };
    window.addEventListener("peranto:disco", onDisco);
    return () => window.removeEventListener("peranto:disco", onDisco);
  }, []);

  const applyTemplate = useCallback((key: string) => {
    setSchemaKey(key);
    const t = TEMPLATES[key];
    if (t) setFields(fieldsFromSpecs(t.fields));
  }, []);

  const checkAuth = useCallback(
    async (key: string) => {
      if (!session) return;
      setAuthStatus("checking");
      try {
        const client = await getReadClient();
        const ok = await client.isAuthorized(session.address, key);
        setAuthStatus(ok ? "authorized" : "unauthorized");
      } catch {
        setAuthStatus("error");
      }
    },
    [session]
  );

  useEffect(() => {
    if (tab === "issue" && schemaKey) void checkAuth(schemaKey);
  }, [tab, schemaKey, checkAuth]);

  function applyParsedRequest(p: ParsedRequest) {
    setSchemaKey(p.schemaKey);
    setSubject(p.subjectAddress);
    if (p.note) setReqNote(p.note);

    const tmpl = TEMPLATES[p.schemaKey];
    if (tmpl) {
      const base = fieldsFromSpecs(tmpl.fields);
      if (Object.keys(p.claims).length > 0) {
        setFields(
          base.map((field) => {
            if (!(field.key in p.claims)) return field;
            const raw = p.claims[field.key];
            return {
              ...field,
              value:
                raw == null
                  ? ""
                  : typeof raw === "string" ||
                      typeof raw === "number" ||
                      typeof raw === "boolean"
                    ? String(raw)
                    : JSON.stringify(raw),
            };
          })
        );
      } else {
        setFields(base);
      }
    } else if (Object.keys(p.claims).length > 0) {
      setFields(
        fieldsFromClaims(p.claims, [], typeHintsFor(p.schemaKey))
      );
    } else {
      setFields([]);
    }

    if (p.disco?.address && isAddress(p.disco.address)) {
      const next: ActiveDisco = {
        address: p.disco.address as Address,
        name: p.disco.name || shortAddr(p.disco.address),
        offerSchemas: disco?.offerSchemas?.length
          ? disco.offerSchemas
          : defaultOffers(),
      };
      if (!disco || disco.address.toLowerCase() !== next.address.toLowerCase()) {
        saveActiveDisco(next);
        setDisco(next);
      }
    }

    setParsed(p);
    void checkAuth(p.schemaKey);
  }

  function onPasteRequest() {
    setErr("");
    setMsg("");
    try {
      const p = parseCredentialRequest(pasteRaw);
      applyParsedRequest(p);
      const label = TEMPLATES[p.schemaKey]?.label ?? p.schemaKey;
      setMsg(`Solicitud detectada: ${label} → ${shortAddr(p.subjectAddress as Address)}`);
    } catch (e) {
      setParsed(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const issueMode = isRegistrySchema(schemaKey) ? "values" : "free";
  const requestMode = isRegistrySchema(schemaKey) ? "values" : "free";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <Navigate to="/login" replace />;

  const offers = disco?.offerSchemas?.length
    ? disco.offerSchemas
    : defaultOffers();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
          Credenciales
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink)]/70">
          Catálogo del DisCO, solicitar, emitir y registrar schemas con tipos de
          dato. Los valores van en el JWT; on-chain solo el ancla.{" "}
          <Link to="/guide" className="text-[var(--color-moss)] underline-offset-2 hover:underline">
            ¿Qué es esto? Ver guía
          </Link>
        </p>
      </header>

      <DiscoContextBar disco={disco} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="catalog" className="rounded-full">
            Reclamar
          </TabsTrigger>
          <TabsTrigger value="request" className="rounded-full">
            Solicitar
          </TabsTrigger>
          <TabsTrigger value="issue" className="rounded-full">
            Emitir
          </TabsTrigger>
          <TabsTrigger value="manage" className="rounded-full">
            Anclas / Revocar
          </TabsTrigger>
          <TabsTrigger value="schema" className="rounded-full">
            Schema
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-3">
          <HelpCallout title="¿Qué es “reclamar”?">
            <p>
              Lista pública de schemas que este DisCO ofrece. No son datos
              cifrados en el contrato: al reclamar, un attester emite el JWT y
              ancla el hash.
            </p>
          </HelpCallout>
          {!disco && (
            <Card>
              <CardTitle>Elige un DisCO primero</CardTitle>
              <CardDesc>
                En Cooperativa busca el nodo y pulsa “Usar este DisCO”.
              </CardDesc>
              <Link
                to="/coop"
                className={cn(buttonVariants({ size: "sm" }), "mt-3 inline-flex")}
              >
                Ir a Cooperativa
              </Link>
            </Card>
          )}
          <ul className="space-y-2">
            {offers.map((key) => {
              const meta = TEMPLATES[key];
              return (
                <li key={key}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle>{meta?.label ?? key}</CardTitle>
                        <CardDesc>
                          {meta?.blurb ?? "Schema disponible en este nodo."}
                        </CardDesc>
                        <Badge className="mt-2" variant="outline">
                          {key}
                        </Badge>
                        {disco && (
                          <p className="mt-2 text-[11px] text-[var(--color-ink)]/55">
                            Contexto: <strong>{disco.name}</strong>
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button
                          size="sm"
                          disabled={!disco}
                          onClick={() => {
                            applyTemplate(key);
                            setTab("request");
                          }}
                        >
                          Solicitar
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!disco}
                          onClick={() => {
                            applyTemplate(key);
                            setTab("issue");
                          }}
                        >
                          Emitir (attester)
                        </Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </TabsContent>

        <TabsContent value="request" className="space-y-3">
          <HelpCallout title="Solicitud off-chain">
            <p>
              Generas un JSON para el attester del DisCO activo. Él lo pega en{" "}
              <strong>Emitir → Detectar y cargar</strong>. No escribe en chain
              hasta que alguien emita.
            </p>
          </HelpCallout>
          <Card>
            <CardTitle>Plantilla de claims</CardTitle>
            <Label className="mt-3">Schema</Label>
            <Input value={schemaKey} onChange={(e) => setSchemaKey(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.keys(TEMPLATES).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={schemaKey === k ? "default" : "secondary"}
                  onClick={() => applyTemplate(k)}
                >
                  {TEMPLATES[k].label}
                </Button>
              ))}
            </div>
            <div className="mt-4">
              <FieldTemplateEditor
                fields={fields}
                onChange={setFields}
                mode={requestMode}
              />
            </div>
            <Label className="mt-3">Nota al attester</Label>
            <Input
              value={reqNote}
              onChange={(e) => setReqNote(e.target.value)}
              placeholder={`Quiero unirme a ${disco?.name ?? "el DisCO"}…`}
            />
            <Button
              className="mt-3"
              disabled={!session}
              onClick={() => {
                const body = {
                  type: "peranto.credentialRequest",
                  version: 1,
                  createdAt: new Date().toISOString(),
                  disco: disco
                    ? { name: disco.name, address: disco.address }
                    : null,
                  subject: {
                    did: session.did,
                    address: session.address,
                    name: session.displayName
                      ? `@${session.displayName}`
                      : undefined,
                  },
                  schemaKey,
                  claimsHint: fieldsToClaims(fields),
                  note: reqNote || undefined,
                };
                setReqJson(JSON.stringify(body, null, 2));
                setMsg("Solicitud lista — cópiala y envíala al attester");
              }}
            >
              Generar solicitud
            </Button>
            {reqJson && (
              <>
                <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-[var(--color-moss)]/5 p-3 text-[10px]">
                  {reqJson}
                </pre>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(reqJson);
                    setMsg("Copiado");
                  }}
                >
                  Copiar
                </Button>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="issue" className="space-y-3">
          <HelpCallout title="Emitir desde una solicitud">
            <p>
              Pega el JSON que te envió el solicitante: la plataforma detecta el
              schema, el subject y los claims, y comprueba si tu identidad puede
              atestarlo (<code className="text-[10px]">isAuthorized</code>).
            </p>
          </HelpCallout>

          <Card>
            <CardTitle>Pegar solicitud JSON</CardTitle>
            <CardDesc>
              Formato <code className="text-[10px]">peranto.credentialRequest</code>{" "}
              (el que se genera en Solicitar).
            </CardDesc>
            <Textarea
              className="mt-3 min-h-28 font-mono text-xs"
              value={pasteRaw}
              onChange={(e) => setPasteRaw(e.target.value)}
              placeholder='{ "type": "peranto.credentialRequest", "schemaKey": "…", … }'
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!pasteRaw.trim()}
                onClick={onPasteRequest}
              >
                Detectar y cargar
              </Button>
              {pasteRaw && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPasteRaw("");
                    setParsed(null);
                  }}
                >
                  Limpiar
                </Button>
              )}
            </div>

            {parsed && (
              <div className="mt-4 space-y-2 rounded-xl border border-[var(--color-moss)]/15 bg-[var(--color-mist)]/40 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Detectado
                  </span>
                  <Badge>
                    {TEMPLATES[parsed.schemaKey]?.label ?? parsed.schemaKey}
                  </Badge>
                  {!TEMPLATES[parsed.schemaKey] && (
                    <Badge variant="outline">schema custom</Badge>
                  )}
                </div>
                <p className="text-xs text-[var(--color-ink)]/70">
                  Subject:{" "}
                  <strong className="font-mono">
                    {parsed.subjectName ? `${parsed.subjectName} · ` : ""}
                    {shortAddr(parsed.subjectAddress as Address)}
                  </strong>
                  {parsed.subjectDid && (
                    <span className="mt-0.5 block truncate font-mono text-[10px] opacity-60">
                      {parsed.subjectDid}
                    </span>
                  )}
                </p>
                {parsed.note && (
                  <p className="text-xs text-[var(--color-ink)]/60">
                    Nota: {parsed.note}
                  </p>
                )}
                {parsed.disco?.address && (
                  <p className="text-xs text-[var(--color-ink)]/60">
                    DisCO pedido:{" "}
                    <strong>{parsed.disco.name ?? shortAddr(parsed.disco.address)}</strong>
                    {disco &&
                    disco.address.toLowerCase() ===
                      parsed.disco.address.toLowerCase() ? (
                      <Badge className="ml-2" variant="secondary">
                        coincide con activo
                      </Badge>
                    ) : (
                      <Badge className="ml-2" variant="outline">
                        sincronizado al pegar
                      </Badge>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Tu identidad attester
                  </span>
                  {authStatus === "checking" && (
                    <Badge variant="outline">Comprobando…</Badge>
                  )}
                  {authStatus === "authorized" && (
                    <Badge className="bg-[var(--color-moss)]/20 text-[var(--color-moss-deep)]">
                      Puedes atestar {schemaKey}
                    </Badge>
                  )}
                  {authStatus === "unauthorized" && (
                    <Badge variant="destructive">
                      Sin autorización para este schema
                    </Badge>
                  )}
                  {authStatus === "error" && (
                    <Badge variant="outline">No se pudo consultar auth</Badge>
                  )}
                </div>
                {authStatus === "unauthorized" && (
                  <p className="text-[11px] text-[var(--color-ink)]/55">
                    Necesitas <strong>stakeAndJoin</strong> para{" "}
                    <code className="text-[10px]">{schemaKey}</code> con esta
                    cuenta antes de emitir.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Emitir y anclar</CardTitle>
            {disco && (
              <p className="mt-1 text-xs text-[var(--color-moss)]">
                Desplegando credencial en contexto <strong>{disco.name}</strong>{" "}
                ({disco.address.slice(0, 10)}…)
              </p>
            )}
            {!parsed && authStatus !== "idle" && (
              <div className="mt-2">
                {authStatus === "authorized" && (
                  <Badge className="bg-[var(--color-moss)]/20 text-[var(--color-moss-deep)]">
                    Attester autorizado · {schemaKey}
                  </Badge>
                )}
                {authStatus === "unauthorized" && (
                  <Badge variant="destructive">
                    No autorizado para {schemaKey}
                  </Badge>
                )}
              </div>
            )}
            <Label className="mt-3">Subject (address)</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={session.address}
            />
            <FieldHint>Por defecto: tú mismo. Se rellena al pegar la solicitud.</FieldHint>
            <Label className="mt-2">Schema</Label>
            <Input value={schemaKey} onChange={(e) => setSchemaKey(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.keys(TEMPLATES).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={schemaKey === k ? "default" : "secondary"}
                  onClick={() => applyTemplate(k)}
                >
                  {TEMPLATES[k].label}
                </Button>
              ))}
            </div>
            <div className="mt-4">
              <FieldTemplateEditor
                fields={fields}
                onChange={setFields}
                mode={issueMode}
              />
            </div>
            {schemaKey.includes("Member") && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={alsoMember}
                  onChange={(e) => setAlsoMember(e.target.checked)}
                />
                También addMember en el DisCO activo (si eres gobernanza)
              </label>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await portalStakeAndJoin(schemaKey, session);
                    await checkAuth(schemaKey);
                    setMsg(`Attester listo para ${schemaKey}`);
                  })
                }
              >
                stakeAndJoin
              </Button>
              <Button
                disabled={
                  busy ||
                  !fields.some((f) => f.key && f.value) ||
                  authStatus === "unauthorized"
                }
                onClick={() =>
                  run(async () => {
                    if (authStatus !== "authorized") {
                      const client = await getReadClient();
                      const ok = await client.isAuthorized(
                        session.address,
                        schemaKey
                      );
                      if (!ok) {
                        throw new Error(
                          `Tu identidad no está autorizada para atestar ${schemaKey}. Usa stakeAndJoin.`
                        );
                      }
                      setAuthStatus("authorized");
                    }
                    const sub = (subject.trim() || session.address) as Address;
                    const claims = fieldsToClaims(fields);
                    if (disco) {
                      claims.discoNode = disco.address;
                      claims.discoName = disco.name;
                    }
                    const credType = TEMPLATES[schemaKey]?.label;
                    const issued = await portalIssueClaims(
                      sub,
                      claims,
                      schemaKey,
                      credType,
                      session
                    );
                    await saveJwtToVault(issued);
                    setLastIssued({
                      jwt: issued.jwt,
                      credHash: issued.credHash,
                      schemaKey: issued.schemaKey,
                      subject: sub,
                      subjectDid: issued.subjectDid,
                    });
                    if (alsoMember && schemaKey.includes("Member") && disco) {
                      try {
                        const { portalAddMember } = await import("@/lib/client");
                        await portalAddMember(disco.address, sub, session);
                        setMsg(
                          `Emitida + miembro en ${disco.name} · ${issued.credHash.slice(0, 12)}… — entrega el JWT al miembro`
                        );
                      } catch {
                        setMsg(
                          `Emitida ${issued.credHash.slice(0, 12)}… (addMember falló — ¿gobernanza?) — igual entrega el JWT`
                        );
                      }
                    } else {
                      setMsg(`Emitida · ${issued.credHash} — entrega el JWT al subject`);
                    }
                  })
                }
              >
                Emitir y anclar
              </Button>
            </div>
            {authStatus === "unauthorized" && (
              <FieldHint className="mt-2">
                El botón Emitir está bloqueado hasta que hagas stakeAndJoin (o
                uses una cuenta ya autorizada).
              </FieldHint>
            )}
          </Card>

          {lastIssued && (
            <Card>
              <CardTitle>Entregar al miembro</CardTitle>
              <CardDesc>
                On-chain ya quedó el ancla (y membresía si aplicó). El{" "}
                <strong>JWT con los datos</strong> no viaja solo: hay que
                pasárselo off-chain.
              </CardDesc>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[var(--color-ink)]/75">
                <li>Copia el JWT abajo.</li>
                <li>
                  Envíalo al subject (
                  <code className="text-[10px]">
                    {shortAddr(lastIssued.subject as Address)}
                  </code>
                  ) por el canal que usen (chat, email, AuraInbox…).
                </li>
                <li>
                  El miembro abre <strong>Identidad → Vault → Importar JWT</strong>,
                  pega y guarda.
                </li>
                <li>
                  En su vault verá la credencial; cualquiera puede verificar el
                  ancla on-chain con el hash.
                </li>
              </ol>
              <p className="mt-3 text-[11px] text-[var(--color-ink)]/50">
                Schema {lastIssued.schemaKey} · hash{" "}
                <code className="text-[10px]">{lastIssued.credHash}</code>
              </p>
              <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-[var(--color-moss)]/5 p-3 text-[10px] break-all whitespace-pre-wrap">
                {lastIssued.jwt}
              </pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(lastIssued.jwt);
                    setMsg("JWT copiado — envíalo al miembro");
                  }}
                >
                  Copiar JWT
                </Button>
                <Link
                  to="/id"
                  className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                >
                  Ir a Vault (si eres el subject)
                </Link>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="manage" className="space-y-3">
          <HelpCallout title="Actualizar ≠ editar el JWT">
            <p>
              Un JWT emitido no se modifica. Para “actualizar” datos:{" "}
              <strong>revocas</strong> el ancla vieja (por <code className="text-[10px]">credHash</code>
              ) y <strong>emites una nueva</strong>. No necesitas el JWT original:
              el attester (tú) busca las anclas on-chain del subject y revoca.
            </p>
          </HelpCallout>
          <Card>
            <CardTitle>Buscar anclas on-chain</CardTitle>
            <CardDesc>
              Por subject (quién tiene la VC) o las que tú emitiste como
              attester. El JWT no hace falta para revocar.
            </CardDesc>
            <Label className="mt-3">Subject address (opcional)</Label>
            <Input
              value={lookupSubject}
              onChange={(e) => setLookupSubject(e.target.value)}
              placeholder={subject || "0x… del miembro"}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const client = await getReadClient();
                    const sub = (lookupSubject.trim() ||
                      subject.trim()) as Address | "";
                    if (sub && !isAddress(sub)) {
                      throw new Error("Subject address inválida");
                    }
                    const list = await client.queryCredentialAnchors({
                      ...(sub ? { subject: sub } : {}),
                      attester: session.address,
                    });
                    setAnchors(list);
                    setMsg(
                      list.length
                        ? `${list.length} ancla(s) encontradas`
                        : "Ninguna ancla (como attester) con ese filtro"
                    );
                  })
                }
              >
                Mis emisiones (attester)
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const client = await getReadClient();
                    const sub = (lookupSubject.trim() || subject.trim()) as Address;
                    if (!sub || !isAddress(sub)) {
                      throw new Error("Indica la address del subject");
                    }
                    const list = await client.queryCredentialAnchors({
                      subject: sub,
                    });
                    setAnchors(list);
                    setMsg(
                      list.length
                        ? `${list.length} ancla(s) del subject`
                        : "Sin anclas para ese subject"
                    );
                  })
                }
              >
                Por subject
              </Button>
            </div>
            <Label className="mt-3">Motivo de revocación</Label>
            <Input
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
            />
            <ul className="mt-4 space-y-2">
              {anchors.map((a) => {
                const st = a.status ?? 0;
                const canRevoke =
                  st === 1 &&
                  a.attester.toLowerCase() === session.address.toLowerCase();
                return (
                  <li
                    key={a.credHash}
                    className="rounded-xl border border-[var(--color-moss)]/12 px-3 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <code className="block truncate text-[10px]">
                          {a.credHash}
                        </code>
                        <p className="mt-1 text-xs text-[var(--color-ink)]/60">
                          subject {shortAddr(a.subject)} · attester{" "}
                          {shortAddr(a.attester)}
                        </p>
                        <Badge
                          className="mt-2"
                          variant={st === 1 ? "default" : st === 2 ? "destructive" : "outline"}
                        >
                          {STATUS_LABEL[st] ?? st}
                        </Badge>
                        {a.revokeReason && (
                          <p className="mt-1 text-[11px] text-[var(--color-ink)]/50">
                            {a.revokeReason}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !canRevoke}
                        onClick={() =>
                          run(async () => {
                            await portalRevoke(
                              a.credHash,
                              revokeReason || "revoked",
                              session
                            );
                            setMsg(`Revocada ${a.credHash.slice(0, 12)}…`);
                            const client = await getReadClient();
                            const list = await client.queryCredentialAnchors({
                              subject: a.subject,
                              attester: session.address,
                            });
                            setAnchors(list);
                          })
                        }
                      >
                        Revocar
                      </Button>
                    </div>
                  </li>
                );
              })}
              {anchors.length === 0 && (
                <p className="text-sm text-[var(--color-ink)]/55">
                  Busca anclas arriba. Si ya emitiste y perdiste el JWT, igual
                  puedes revocar con el hash on-chain.
                </p>
              )}
            </ul>
          </Card>
          <Card>
            <CardTitle>Flujo de actualización</CardTitle>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-[var(--color-ink)]/75">
              <li>Busca anclas Active del miembro.</li>
              <li>Revoca la anterior (sin JWT).</li>
              <li>
                Emite de nuevo en <strong>Emitir</strong> con los datos nuevos.
              </li>
              <li>Entrega el JWT nuevo al miembro (Importar vault).</li>
            </ol>
          </Card>
        </TabsContent>

        <TabsContent value="schema" className="space-y-3">
          <HelpCallout title="Registrar schema">
            <p>
              Aquí diseñás campos nuevos con su <strong>tipo de dato</strong>{" "}
              (string, integer, number, boolean, date-time). On-chain solo queda
              el hash + URI. Publisher = gobernanza SchemaRegistry.
            </p>
          </HelpCallout>
          <Card>
            <CardTitle>Nueva plantilla de schema</CardTitle>
            {disco && (
              <Badge className="mt-2" variant="outline">
                Catálogo mental de {disco.name}
              </Badge>
            )}
            <Label className="mt-3">schemaKey</Label>
            <Input
              value={newSchemaKey}
              onChange={(e) => setNewSchemaKey(e.target.value)}
              placeholder="peranto:MiEsquema:v1"
            />
            <FieldHint>
              No reutilices keys ya registrados (p. ej. Member:v1) si solo querés
              emitir: usá Emitir con la plantilla fija.
            </FieldHint>
            <div className="mt-4">
              <FieldTemplateEditor
                fields={schemaFields}
                onChange={setSchemaFields}
                mode="schema"
              />
            </div>
            <Button
              className="mt-4"
              disabled={
                busy ||
                !newSchemaKey.trim() ||
                !schemaFields.some((x) => x.key.trim())
              }
              onClick={() =>
                run(async () => {
                  const key = newSchemaKey.trim();
                  const body = fieldsToSchemaBody(key, schemaFields);
                  const r = await portalRegisterSchema(
                    key,
                    body,
                    `https://peranto.app/schemas/${key}.json`,
                    session
                  );
                  if (disco) {
                    const offers = new Set(disco.offerSchemas);
                    offers.add(key);
                    saveActiveDisco({
                      ...disco,
                      offerSchemas: [...offers],
                    });
                    setDisco(loadActiveDisco());
                  }
                  setMsg(`Schema registrado · ${r.schemaId}`);
                })
              }
            >
              Registrar schema on-chain
            </Button>
          </Card>
        </TabsContent>
      </Tabs>

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
