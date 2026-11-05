/**
 * Réordonnancement tactile des entrées du vault.
 *
 * Le glisser-déposer HTML5 (utilisé à la souris) ne se déclenche pas au doigt
 * sur la plupart des mobiles. Ce hook pilote donc le geste en Pointer Events
 * depuis la poignée de la carte, qui porte `touch-action: none` en CSS : le
 * reste de la carte continue de faire défiler la liste normalement.
 */

import { useEffect, useRef, useState } from "react";
import type { PointerEvent, MouseEvent, RefObject } from "react";
import { autoScrollDelta, placementFromPointer } from "../lib/reorder";
import type { DropPlacement } from "../lib/reorder";

/** Attribut posé sur chaque carte pour la retrouver sous le doigt. */
export const ENTRY_ID_ATTRIBUTE = "data-entry-id";

export type DropTarget = { id: string; placement: DropPlacement };

export type TouchHandleProps = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
    onClick: (event: MouseEvent<HTMLElement>) => void;
};

type Options = {
    listRef: RefObject<HTMLElement | null>;
    isDisabled: boolean;
    onDrop: (draggedId: string, target: DropTarget) => void;
};

type Point = { x: number; y: number };

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
    return a?.id === b?.id && a?.placement === b?.placement;
}

function findCardAt({ x, y }: Point): Element | null {
    return document.elementFromPoint(x, y)?.closest(`[${ENTRY_ID_ATTRIBUTE}]`) ?? null;
}

export function useTouchReorder({ listRef, isDisabled, onDrop }: Options) {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

    // Lus par les gestionnaires d'événements et la boucle de défilement, qui
    // doivent voir la dernière valeur sans attendre un rendu React.
    const activePointerId = useRef<number | null>(null);
    const pointer = useRef<Point>({ x: 0, y: 0 });
    const latestTarget = useRef<DropTarget | null>(null);
    const startedByTouch = useRef(false);

    function updateTarget(id: string) {
        const card = findCardAt(pointer.current);
        // Entre deux cartes ou hors de la liste : on garde la dernière cible
        // pour éviter que l'indicateur ne clignote.
        if (!card) return;

        const cardId = card.getAttribute(ENTRY_ID_ATTRIBUTE);
        const next: DropTarget | null = cardId && cardId !== id
            ? { id: cardId, placement: placementFromPointer(pointer.current.y, card.getBoundingClientRect()) }
            : null;

        if (sameTarget(latestTarget.current, next)) return;
        latestTarget.current = next;
        setDropTarget(next);
    }

    function reset() {
        activePointerId.current = null;
        latestTarget.current = null;
        setDraggedId(null);
        setDropTarget(null);
    }

    // Un autre doigt qui se lève ne doit pas interrompre le geste en cours.
    function resetIfActive(event: PointerEvent<HTMLElement>) {
        if (event.pointerId === activePointerId.current) reset();
    }

    // Fait défiler la liste quand le doigt approche d'un bord, y compris s'il
    // ne bouge plus : aucun pointermove n'arrive alors, d'où la boucle.
    useEffect(() => {
        if (!draggedId) return;

        let frame = requestAnimationFrame(function step() {
            const list = listRef.current;
            if (list) {
                const delta = autoScrollDelta(pointer.current.y, list.getBoundingClientRect());
                const before = list.scrollTop;
                list.scrollTop = before + delta;
                if (list.scrollTop !== before) updateTarget(draggedId);
            }
            frame = requestAnimationFrame(step);
        });

        return () => cancelAnimationFrame(frame);
    }, [draggedId, listRef]);

    function getHandleProps(entryId: string): TouchHandleProps {
        return {
            onPointerDown(event) {
                startedByTouch.current = event.pointerType !== "mouse";
                // La souris garde le glisser-déposer HTML5 de la carte.
                if (!startedByTouch.current || !event.isPrimary || isDisabled) return;

                event.currentTarget.setPointerCapture(event.pointerId);
                activePointerId.current = event.pointerId;
                pointer.current = { x: event.clientX, y: event.clientY };
                setDraggedId(entryId);
            },
            onPointerMove(event) {
                if (event.pointerId !== activePointerId.current) return;
                pointer.current = { x: event.clientX, y: event.clientY };
                updateTarget(entryId);
            },
            onPointerUp(event) {
                if (event.pointerId !== activePointerId.current) return;
                const target = latestTarget.current;
                reset();
                if (target) onDrop(entryId, target);
            },
            onPointerCancel: resetIfActive,
            onLostPointerCapture: resetIfActive,
            onClick(event) {
                // Saisir la poignée au doigt ne doit pas ouvrir l'entrée.
                if (startedByTouch.current) event.stopPropagation();
            },
        };
    }

    return { draggedId, dropTarget, getHandleProps };
}
