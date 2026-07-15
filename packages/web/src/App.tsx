import type { ReactNode } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/Login";
import { IdentityPage } from "./pages/Identity";
import { CoopPage } from "./pages/Coop";
import { TreasuryPage } from "./pages/Treasury";
import { ActivityPage } from "./pages/Activity";
import { CredentialsPage } from "./pages/Credentials";
import { GuidePage } from "./pages/Guide";
import { EconomyPage } from "./pages/Economy";
import { AppShell } from "./components/AppShell";
import { loadSession } from "./lib/session";

/** Hash routes on GitHub Pages project sites (no server rewrite for SPA). */
const useHash = import.meta.env.BASE_URL !== "/";
const Router = useHash ? HashRouter : BrowserRouter;

function RequireSession({ children }: { children: ReactNode }) {
  if (!loadSession()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireSession>
              <AppShell />
            </RequireSession>
          }
        >
          <Route path="/id" element={<IdentityPage />} />
          <Route path="/coop" element={<CoopPage />} />
          <Route path="/economia" element={<EconomyPage />} />
          <Route path="/credentials" element={<CredentialsPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/treasury" element={<TreasuryPage />} />
        </Route>
      </Routes>
    </Router>
  );
}
