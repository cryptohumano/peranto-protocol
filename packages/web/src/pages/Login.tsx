import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createHdSession,
  importMnemonicSession,
  importKeySession,
  loadSession,
  saveSession,
  type SessionIdentity,
} from "@/lib/session";
import { connectAura } from "@/lib/client";
import { formatDid } from "@peranto/sdk";
import type { Hex } from "viem";

export function LoginPage() {
  const nav = useNavigate();
  const [existing, setExisting] = useState<SessionIdentity | null>(null);
  const [mnemonic, setMnemonic] = useState("");
  const [pk, setPk] = useState("");
  const [created, setCreated] = useState<SessionIdentity | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setExisting(loadSession());
  }, []);

  async function onCreate() {
    setBusy(true);
    setError("");
    try {
      const s = await createHdSession("paseo");
      setCreated(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onImportMnemonic() {
    setBusy(true);
    setError("");
    try {
      await importMnemonicSession(mnemonic.trim(), "paseo");
      nav("/id");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onImportPk() {
    setBusy(true);
    setError("");
    try {
      const key = (pk.trim().startsWith("0x") ? pk.trim() : `0x${pk.trim()}`) as Hex;
      importKeySession(key, "paseo");
      nav("/id");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAura() {
    setBusy(true);
    setError("");
    try {
      const accounts = await connectAura();
      if (!accounts[0]) throw new Error("Sin cuentas Aura");
      const s: SessionIdentity = {
        address: accounts[0] as `0x${string}`,
        did: formatDid("paseo", accounts[0] as `0x${string}`),
        source: "aura",
      };
      saveSession(s);
      nav("/id");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (existing && !created) {
    return <Navigate to="/id" replace />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <p className="font-display text-4xl font-bold tracking-tight text-[var(--color-moss-deep)]">
        Peranto
      </p>
      <p className="mt-2 max-w-md text-base text-[var(--color-ink)]/75">
        Identidad <code className="text-sm">did:peranto</code> con HD. El DID es implícito — no
        requiere stake. El nombre es fee opcional.
      </p>

      {created ? (
        <Card className="mt-8">
          <CardTitle>Guarda tu mnemonic</CardTitle>
          <CardDesc>No se vuelve a mostrar. Sin ella no recuperas la identidad.</CardDesc>
          <pre className="mt-4 whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--color-moss-deep)] p-4 text-sm text-[var(--color-paper)]">
            {created.mnemonic}
          </pre>
          <p className="mt-3 text-sm">
            DID: <code className="text-xs">{created.did}</code>
          </p>
          <Button className="mt-4" onClick={() => nav("/id")}>
            Entrar al portal
          </Button>
        </Card>
      ) : (
        <Card className="mt-8">
          <Tabs defaultValue="create">
            <TabsList>
              <TabsTrigger value="create">Crear HD</TabsTrigger>
              <TabsTrigger value="mnemonic">Importar</TabsTrigger>
              <TabsTrigger value="aura">Aura</TabsTrigger>
            </TabsList>
            <TabsContent value="create" className="mt-4 space-y-3">
              <p className="text-sm text-[var(--color-ink)]/70">
                Genera mnemonic BIP39 → secp256k1 (EVM/PVM) + Substrate.
              </p>
              <Button disabled={busy} onClick={onCreate}>
                Crear identidad
              </Button>
            </TabsContent>
            <TabsContent value="mnemonic" className="mt-4 space-y-3">
              <div>
                <Label>Mnemonic</Label>
                <Textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} />
              </div>
              <div>
                <Label>O clave privada EVM</Label>
                <Input value={pk} onChange={(e) => setPk(e.target.value)} placeholder="0x…" />
              </div>
              <div className="flex gap-2">
                <Button disabled={busy || !mnemonic.trim()} onClick={onImportMnemonic}>
                  Importar mnemonic
                </Button>
                <Button variant="secondary" disabled={busy || !pk.trim()} onClick={onImportPk}>
                  Importar PK
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="aura" className="mt-4 space-y-3">
              <p className="text-sm text-[var(--color-ink)]/70">
                Navegador + Aura: la extensión firma y emite (la clave no sale del wallet).
                PWA / TUI sin extensión: usa Crear HD o Importar.
              </p>
              <Button disabled={busy} onClick={onAura}>
                Conectar Aura
              </Button>
            </TabsContent>
          </Tabs>
          {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
        </Card>
      )}

      <p className="mt-6 text-center text-sm text-[var(--color-ink)]/50">
        <Link to="/coop" className="underline">
          Ir a cooperativa
        </Link>{" "}
        sin login (solo lectura)
      </p>
    </div>
  );
}
