import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIdleLock } from "./useIdleLock";

const MINUTE = 60_000;

function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
}

describe("useIdleLock", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setVisibility("visible");
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("locks after the idle delay without any user activity", () => {
        const onLock = vi.fn();
        renderHook(() => useIdleLock(onLock, { idleMs: 10 * MINUTE, hiddenMs: 5 * MINUTE }));

        vi.advanceTimersByTime(9 * MINUTE);
        expect(onLock).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1.5 * MINUTE);
        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it("restarts the idle delay on keyboard, pointer and touch activity", () => {
        const onLock = vi.fn();
        renderHook(() => useIdleLock(onLock, { idleMs: 10 * MINUTE, hiddenMs: 5 * MINUTE }));

        vi.advanceTimersByTime(8 * MINUTE);
        window.dispatchEvent(new KeyboardEvent("keydown"));
        vi.advanceTimersByTime(8 * MINUTE);
        window.dispatchEvent(new Event("pointerdown"));
        vi.advanceTimersByTime(8 * MINUTE);

        expect(onLock).not.toHaveBeenCalled();
    });

    it("locks once the page has stayed in the background for the hidden delay", () => {
        const onLock = vi.fn();
        renderHook(() => useIdleLock(onLock, { idleMs: 10 * MINUTE, hiddenMs: 5 * MINUTE }));

        setVisibility("hidden");
        vi.advanceTimersByTime(5.5 * MINUTE);

        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it("locks as soon as the page comes back if background timers were frozen meanwhile", () => {
        const onLock = vi.fn();
        renderHook(() => useIdleLock(onLock, { idleMs: 10 * MINUTE, hiddenMs: 5 * MINUTE }));

        setVisibility("hidden");
        // Onglet gelé (mobile) : l'heure avance, aucun minuteur ne s'exécute.
        vi.setSystemTime(Date.now() + 6 * MINUTE);
        setVisibility("visible");

        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it("stops watching once unmounted", () => {
        const onLock = vi.fn();
        const { unmount } = renderHook(() => useIdleLock(onLock, { idleMs: 10 * MINUTE, hiddenMs: 5 * MINUTE }));
        unmount();
        vi.advanceTimersByTime(30 * MINUTE);
        expect(onLock).not.toHaveBeenCalled();
    });
});
