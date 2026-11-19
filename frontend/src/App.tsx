import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import VaultPage from "./pages/VaultPage";
import AuthPage from "./pages/AuthPage";
import SessionsPage from "./pages/SessionsPage";
import SecurityAuditPage from "./pages/SecurityAuditPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import CookiesPage from "./pages/CookiesPage";

export default function App() {
  return (
      <BrowserRouter>
        <Routes>
          {/* Racine → redirige selon l'état de session */}
          <Route path="/" element={<Navigate to="/vault" replace />} />

          {/* Vault - protégé */}
          <Route
              path="/vault"
              element={
                <ProtectedRoute>
                  <VaultPage />
                </ProtectedRoute>
              }
          />

          {/* Analyse du vault - protégé */}
          <Route
              path="/security"
              element={
                <ProtectedRoute>
                  <SecurityAuditPage />
                </ProtectedRoute>
              }
          />

          {/* Login */}
          <Route path="/login" element={<AuthPage />} />

          {/* Pages légales - publiques */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/cookies" element={<CookiesPage />} />

          {/* Sessions - protégé */}
          <Route
              path="/sessions"
              element={
                <ProtectedRoute>
                    <SessionsPage />
                </ProtectedRoute>
              }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
  );
}
