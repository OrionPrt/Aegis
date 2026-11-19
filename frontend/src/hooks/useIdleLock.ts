import { useEffect, useRef } from "react";

export interface IdleLockDelays {
    /** Sans activité clavier, souris ou tactile pendant ce délai : verrouillage. */
    idleMs: number;
    /** Onglet ou application en arrière-plan pendant ce délai : verrouillage. */
    hiddenMs: number;
}

/** 10 minutes sans activité, ou 5 minutes en arrière-plan. */
export const DEFAULT_IDLE_LOCK_DELAYS: IdleLockDelays = {
    idleMs:   10 * 60_000,
    hiddenMs:  5 * 60_000,
};

/** Fréquence de vérification ; l'heure réelle fait foi, pas le nombre de tours. */
const CHECK_INTERVAL_MS = 15_000;

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/**
 * Appelle `onLock` une fois quand l'utilisateur est inactif trop longtemps
 * ou que la page reste trop longtemps en arrière-plan. Les délais sont
 * comparés à l'heure réelle : un onglet gelé par le navigateur (mobile) est
 * verrouillé dès qu'il revient au premier plan.
 */
export function useIdleLock(onLock: () => void, delays: IdleLockDelays = DEFAULT_IDLE_LOCK_DELAYS): void {
    const onLockRef = useRef(onLock);
    useEffect(() => { onLockRef.current = onLock; }, [onLock]);

    const { idleMs, hiddenMs } = delays;

    useEffect(() => {
        let lastActivity = Date.now();
        let hiddenSince: number | null = document.visibilityState === "hidden" ? Date.now() : null;
        let locked = false;

        function check() {
            if (locked) return;
            const now = Date.now();
            const idleTooLong   = now - lastActivity >= idleMs;
            const hiddenTooLong = hiddenSince !== null && now - hiddenSince >= hiddenMs;
            if (idleTooLong || hiddenTooLong) {
                locked = true;
                onLockRef.current();
            }
        }

        function onActivity() {
            lastActivity = Date.now();
        }

        function onVisibilityChange() {
            if (document.visibilityState === "hidden") {
                hiddenSince = Date.now();
                return;
            }
            check();
            hiddenSince = null;
            if (!locked) lastActivity = Date.now();
        }

        const interval = setInterval(check, CHECK_INTERVAL_MS);
        for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { passive: true });
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            clearInterval(interval);
            for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [idleMs, hiddenMs]);
}
