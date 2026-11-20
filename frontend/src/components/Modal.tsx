import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
    "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalProps {
    title: ReactNode;
    /** Classe du titre (ex. "modal-title-danger"). */
    titleClassName?: string;
    size?: "sm";
    onClose: () => void;
    /** false pendant une opération en cours : Échap, le fond et la croix ne ferment plus. */
    dismissible?: boolean;
    children: ReactNode;
}

function focusableIn(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

interface FocusReturn {
    /** Élément qui avait le focus à l'ouverture. */
    opener: HTMLElement | null;
    /** Retour de la fenêtre dont faisait partie l'ouvreur, s'il était dans une fenêtre. */
    parent: FocusReturn | null;
}

/**
 * Retour de focus de chaque fenêtre ouverte, par élément dialog : une fenêtre
 * ouverte depuis une autre (qui se ferme au même moment) le lit pour savoir
 * où revenir quand le bouton qui l'a ouverte a disparu avec la première.
 */
const focusReturns = new WeakMap<HTMLElement, FocusReturn>();

/** L'ouvreur s'il est encore dans la page, sinon celui de la fenêtre d'où il venait. */
function returnTarget(focusReturn: FocusReturn | null): HTMLElement | null {
    if (!focusReturn) return null;
    if (focusReturn.opener?.isConnected) return focusReturn.opener;
    return returnTarget(focusReturn.parent);
}

/**
 * Fenêtre modale accessible : rôle dialog nommé par son titre, focus placé
 * dedans à l'ouverture et rendu à l'élément d'origine à la fermeture, Tab
 * qui boucle à l'intérieur, Échap pour fermer. Une fenêtre qui en remplace
 * une autre (son bouton disparaît avec elle) rend le focus à l'élément qui
 * avait ouvert la première.
 */
export default function Modal({ title, titleClassName, size, onClose, dismissible = true, children }: ModalProps) {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const pointerDownOnOverlay = useRef(false);
    // Élément qui avait le focus à l'ouverture, lu au premier rendu (la
    // fenêtre qu'on remplace, s'il y en a une, est encore dans la page).
    const [focusReturn] = useState<FocusReturn>(() => {
        const opener = document.activeElement as HTMLElement | null;
        const parentDialog = opener?.closest<HTMLElement>('[role="dialog"]');
        return { opener, parent: parentDialog ? focusReturns.get(parentDialog) ?? null : null };
    });

    // Focus initial : l'élément marqué data-autofocus, sinon le premier champ
    // hors croix de fermeture. (Pas l'attribut autoFocus de React : sous
    // StrictMode, l'effet rejoué rendrait le focus à l'ouvreur entre-temps.)
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog) {
            focusReturns.set(dialog, focusReturn);
            const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
            const firstField = focusableIn(dialog).find((el) => !el.classList.contains("modal-close"));
            (preferred ?? firstField ?? dialog).focus();
        }
        return () => returnTarget(focusReturn)?.focus?.();
    }, [focusReturn]);

    function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
        if (e.key === "Escape") {
            e.stopPropagation();
            if (dismissible) onClose();
            return;
        }
        if (e.key !== "Tab" || !dialogRef.current) return;

        const focusable = focusableIn(dialogRef.current);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    return (
        <div
            className="modal-overlay"
            // Fermer seulement si le clic a commencé ET fini sur le fond : une
            // sélection de texte commencée dans un champ et relâchée dehors ne
            // doit pas faire perdre la saisie.
            onPointerDown={(e) => { pointerDownOnOverlay.current = e.target === e.currentTarget; }}
            onClick={(e) => {
                if (dismissible && pointerDownOnOverlay.current && e.target === e.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef}
                className={size === "sm" ? "modal modal-sm" : "modal"}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
            >
                <div className="modal-header">
                    <h2 id={titleId} className={titleClassName}>{title}</h2>
                    <button
                        type="button"
                        className="modal-close"
                        onClick={onClose}
                        disabled={!dismissible}
                        aria-label="Fermer"
                    >
                        <X size={15} strokeWidth={2} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
