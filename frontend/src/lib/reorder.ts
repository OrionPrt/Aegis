/**
 * Logique pure du réordonnancement des entrées du vault (sans DOM ni React).
 */

export type DropPlacement = "before" | "after";

/** Hauteur (px) de la zone proche d'un bord qui déclenche le défilement. */
const AUTO_SCROLL_EDGE_PX = 64;
/** Vitesse maximale du défilement automatique, en px par image. */
const AUTO_SCROLL_MAX_STEP_PX = 10;

/**
 * Retourne une nouvelle liste où `draggedId` est placé avant ou après
 * `targetId`. Retourne la liste d'origine si le déplacement est impossible ou
 * ne change rien, ce qui permet à l'appelant de ne rien sauvegarder.
 */
export function moveEntry<T extends { id: string }>(
    list: readonly T[],
    draggedId: string,
    targetId: string,
    placement: DropPlacement = "before",
): readonly T[] {
    if (draggedId === targetId) return list;

    const dragged = list.find((e) => e.id === draggedId);
    if (!dragged) return list;

    const rest = list.filter((e) => e.id !== draggedId);
    const targetIndex = rest.findIndex((e) => e.id === targetId);
    if (targetIndex === -1) return list;

    const insertAt = placement === "before" ? targetIndex : targetIndex + 1;
    const moved = [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)];
    return moved.every((entry, index) => entry === list[index]) ? list : moved;
}

/** Moitié haute de la carte survolée : avant elle ; moitié basse : après. */
export function placementFromPointer(
    pointerY: number,
    rect: { top: number; height: number },
): DropPlacement {
    return pointerY < rect.top + rect.height / 2 ? "before" : "after";
}

/**
 * Pas de défilement à appliquer pour une position du doigt : négatif vers le
 * haut, positif vers le bas, nul loin des bords. Plus le doigt approche du
 * bord, plus le défilement est rapide.
 */
export function autoScrollDelta(
    pointerY: number,
    bounds: { top: number; bottom: number },
): number {
    const towardsTop = bounds.top + AUTO_SCROLL_EDGE_PX - pointerY;
    if (towardsTop > 0) return -scrollStep(towardsTop);

    const towardsBottom = pointerY - (bounds.bottom - AUTO_SCROLL_EDGE_PX);
    if (towardsBottom > 0) return scrollStep(towardsBottom);

    return 0;
}

function scrollStep(depthInEdgeZone: number): number {
    const ratio = Math.min(depthInEdgeZone / AUTO_SCROLL_EDGE_PX, 1);
    return Math.ceil(ratio * AUTO_SCROLL_MAX_STEP_PX);
}
