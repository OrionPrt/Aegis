import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { isAuthenticated } from "./lib/auth-client";
import VaultPage from "./pages/VaultPage";
import AuthPage from "./pages/AuthPage";
import SessionsPage from "./pages/SessionsPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
      <BrowserRouter>
        <Routes>
          {/* Racine → redirige selon l'état de session */}
          <Route path="/" element={<Navigate to="/vault" replace />} />

          {/* Vault — protégé */}
          <Route
              path="/vault"
              element={
                <ProtectedRoute>
                  <VaultPage />
                </ProtectedRoute>
              }
          />

          {/* Login */}
          <Route path="/login" element={<AuthPage />} />

          {/* Sessions — protégé */}
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
