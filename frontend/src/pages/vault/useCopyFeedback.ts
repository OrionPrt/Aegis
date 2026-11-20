import { useCallback, useEffect, useRef, useState } from "react";
import { copySecret, COPY_FAILED_MESSAGE } from "../../lib/clipboard";

/** Durée du retour visuel « copié » sur un bouton de copie. */
const COPIED_FEEDBACK_MS = 2000;

/**
 * Copie avec retour visuel : `copied` vaut l'identifiant du dernier champ
 * copié pendant 2 s, `copyError` explique un refus du navigateur.
 */
export function useCopyFeedback() {
    const [copied,    setCopied]    = useState<string | null>(null);
    const [copyError, setCopyError] = useState<string | null>(null);
    const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    }, []);

    const copy = useCallback(async (text: string, field: string) => {
        try {
            await copySecret(text);
        } catch {
            setCopied(null);
            setCopyError(COPY_FAILED_MESSAGE);
            return;
        }
        setCopyError(null);
        setCopied(field);
        if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
        feedbackTimer.current = setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS);
    }, []);

    return { copied, copyError, copy };
}
