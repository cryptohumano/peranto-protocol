import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/Login";
import { IdentityPage } from "./pages/Identity";
import { CoopPage } from "./pages/Coop";
import { TreasuryPage } from "./pages/Treasury";
import { ActivityPage } from "./pages/Activity";
import { CredentialsPage } from "./pages/Credentials";
import { GuidePage } from "./pages/Guide";
import { AppShell } from "./components/AppShell";
import { loadSession } from "./lib/session";

function RequireSession({ children }: { children: ReactNode }) {
  if (!loadSession()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="/credentials" element={<CredentialsPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/treasury" element={<TreasuryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
