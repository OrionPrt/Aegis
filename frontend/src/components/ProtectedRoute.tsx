import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { clearSession, getSession, subscribeSession } from "../lib/auth-client";
import { useIdleLock } from "../hooks/useIdleLock";

/** État de navigation passé à /login, pour expliquer pourquoi on y revient. */
export interface LoginRedirectState {
    lockReason?: "inactivity";
}

/**
 * N'affiche ses enfants que tant qu'une session (et donc la clé de
 * déchiffrement) est en mémoire. Réagit à sa disparition - déconnexion,
 * session expirée, verrouillage - en renvoyant vers /login, et verrouille
 * le coffre après une période d'inactivité (useIdleLock).
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
    const session = useSyncExternalStore(subscribeSession, getSession);
    const [lockedForInactivity, setLockedForInactivity] = useState(false);

    if (!session) {
        const state: LoginRedirectState | undefined = lockedForInactivity ? { lockReason: "inactivity" } : undefined;
        return <Navigate to="/login" replace state={state} />;
    }

    return (
        <IdleLockGuard
            onLock={() => {
                setLockedForInactivity(true);
                // Efface la clé et le jeton de la mémoire : le coffre déchiffré
                // disparaît avec la page, il faudra retaper le mot de passe maître.
                clearSession();
            }}
        >
            {children}
        </IdleLockGuard>
    );
}

function IdleLockGuard({ onLock, children }: { onLock: () => void; children: ReactNode }) {
    useIdleLock(onLock);
    return <>{children}</>;
}
