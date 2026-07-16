import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, BadgeCheck, BookOpen, Fingerprint, Landmark, Link2, LogOut, Store, Users, Wallet } from "lucide-react";
import { shortAddr } from "@/lib/utils";
import { formatPas } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  knownNamesFor,
  loadSession,
  rememberName,
  saveSession,
  type SessionIdentity,
} from "@/lib/session";
import { getReadClient } from "@/lib/client";
import { loadActiveDisco } from "@/lib/disco";

const NAV = [
  { to: "/id", label: "Identidad", icon: Fingerprint },
  { to: "/page", label: "linktr33", icon: Link2 },
  { to: "/coop", label: "Cooperativa", icon: Users },
  { to: "/economia", label: "Economía", icon: Store },
  { to: "/credentials", label: "Credenciales", icon: BadgeCheck },
  { to: "/guide", label: "Guía", icon: BookOpen },
  { to: "/activity", label: "Transacciones", icon: ArrowLeftRight },
  { to: "/treasury", label: "Tesoros", icon: Landmark },
];

type Holdings = {
  walletWei: bigint;
  managedWei: bigint;
  totalWei: bigint;
  nodeCount: number;
};

export function AppShell() {
  const nav = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<SessionIdentity | null>(null);
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [activeDisco, setActiveDisco] = useState(loadActiveDisco);

  const refreshHoldings = useCallback(async (address: `0x${string}`) => {
    try {
      const client = await getReadClient();
      const h = await client.getHoldings(address);
      setHoldings({
        walletWei: h.walletWei,
        managedWei: h.managedWei,
        totalWei: h.totalWei,
        nodeCount: h.nodes.filter((n) => n.role === "governance").length,
      });
    } catch {
      setHoldings(null);
    }
  }, []);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    const onSession = (ev: Event) => {
      const next =
        (ev as CustomEvent<SessionIdentity | null>).detail ?? loadSession();
      setSession(next);
      if (next) void refreshHoldings(next.address);
    };
    window.addEventListener("peranto:session", onSession);
    if (!s) return () => window.removeEventListener("peranto:session", onSession);
    void (async () => {
      try {
        const client = await getReadClient();
        const hints = [
          ...(s.displayName ? [s.displayName] : []),
          ...knownNamesFor(s.address),
        ];
        const name = await client.getPrimaryName(s.address, hints);
        if (name && name !== s.displayName) {
          rememberName(s.address, name);
          saveSession({ ...s, displayName: name });
        }
        await refreshHoldings(s.address);
        // Background: buscar txs del usuario y guardarlas en IndexedDB
        void import("@/lib/activity-sync")
          .then(({ syncUserActivity }) => syncUserActivity(s.address))
          .catch(() => {
            /* ignore offline / RPC */
          });
      } catch {
        /* ignore */
      }
    })();
    const holdingsTimer = window.setInterval(() => {
      const cur = loadSession();
      if (cur) void refreshHoldings(cur.address);
    }, 30_000);
    const activityTimer = window.setInterval(() => {
      const cur = loadSession();
      if (cur) {
        void import("@/lib/activity-sync")
          .then(({ syncUserActivity }) => syncUserActivity(cur.address))
          .catch(() => undefined);
      }
    }, 120_000);
    return () => {
      window.removeEventListener("peranto:session", onSession);
      window.clearInterval(holdingsTimer);
      window.clearInterval(activityTimer);
    };
  }, [refreshHoldings]);

  useEffect(() => {
    const s = loadSession();
    if (s) void refreshHoldings(s.address);
  }, [location.pathname, refreshHoldings]);

  useEffect(() => {
    const onDisco = (ev: Event) => {
      setActiveDisco(
        (ev as CustomEvent<ReturnType<typeof loadActiveDisco>>).detail ??
          loadActiveDisco()
      );
    };
    window.addEventListener("peranto:disco", onDisco);
    return () => window.removeEventListener("peranto:disco", onDisco);
  }, []);

  const title = session?.displayName
    ? `@${session.displayName}`
    : session?.did
      ? shortAddr(session.did.replace(/^did:peranto:[^:]+:/, ""), 6)
      : "Peranto";

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon" variant="sidebar">
          <SidebarHeader>
            <div className="flex flex-col gap-1 px-2 py-3 group-data-[collapsible=icon]:hidden">
              <p className="font-display text-2xl font-bold tracking-tight text-sidebar-primary">
                Peranto
              </p>
              <p className="text-xs text-muted-foreground">Identidad DisCO</p>
            </div>
            <div className="hidden px-2 py-2 group-data-[collapsible=icon]:block">
              <span className="font-display text-lg font-bold text-sidebar-primary">P</span>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Identificador</SidebarGroupLabel>
              <SidebarGroupContent className="px-2 group-data-[collapsible=icon]:hidden">
                <p className="font-display text-lg font-semibold text-sidebar-primary">
                  {session?.displayName ? (
                    <>
                      <span className="text-[var(--color-clay)]">@</span>
                      {session.displayName}
                    </>
                  ) : (
                    title
                  )}
                </p>
                {session?.displayName && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {session.did}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="secondary">{session?.source ?? "—"}</Badge>
                  {session && (
                    <Badge variant="outline">{shortAddr(session.address)}</Badge>
                  )}
                  {activeDisco && (
                    <Badge className="bg-[var(--color-moss)]/15 text-[var(--color-moss-deep)]">
                      {activeDisco.name}
                    </Badge>
                  )}
                </div>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel className="flex items-center gap-1">
                <Wallet className="size-3" />
                Tokens
              </SidebarGroupLabel>
              <SidebarGroupContent className="space-y-2 px-2 group-data-[collapsible=icon]:hidden">
                {holdings ? (
                  <>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Wallet
                      </p>
                      <p className="font-mono text-sm font-semibold tabular-nums">
                        {formatPas(holdings.walletWei)} PAS
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Nodos (gov) · {holdings.nodeCount}
                      </p>
                      <p className="font-mono text-sm font-semibold tabular-nums">
                        {formatPas(holdings.managedWei)} PAS
                      </p>
                    </div>
                    <div className="rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Total a cargo
                      </p>
                      <p className="font-display text-base font-bold tabular-nums text-sidebar-primary">
                        {formatPas(holdings.totalWei)} PAS
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Cargando saldo…</p>
                )}
              </SidebarGroupContent>
              <SidebarGroupContent className="hidden px-2 group-data-[collapsible=icon]:block">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={
                        holdings
                          ? `${formatPas(holdings.totalWei)} PAS`
                          : "Tokens"
                      }
                    >
                      <Wallet />
                      <span>PAS</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Navegación</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        isActive={location.pathname === to}
                        tooltip={label}
                        render={<NavLink to={to} />}
                      >
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Salir"
                  onClick={() => {
                    saveSession(null);
                    nav("/login");
                  }}
                >
                  <LogOut />
                  <span>Salir</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <span className="font-display font-semibold text-sidebar-primary">{title}</span>
            </div>
            {holdings && (
              <Badge variant="secondary" className="font-mono tabular-nums">
                {formatPas(holdings.walletWei)} PAS
              </Badge>
            )}
          </header>
          <div className="flex-1 overflow-auto">
            <Outlet context={{ session, setSession }} />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
