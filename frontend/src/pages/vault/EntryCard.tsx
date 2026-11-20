import type { KeyboardEvent } from "react";
import { GripVertical, ShieldCheck } from "lucide-react";
import { ENTRY_ID_ATTRIBUTE } from "../../hooks/useTouchReorder";
import type { TouchHandleProps } from "../../hooks/useTouchReorder";
import { ENTRY_DRAG_TYPE } from "./folders";
import { entrySubtitle, formatDate, getInitial } from "./format";
import type { VaultEntryExtended } from "./types";

interface EntryCardProps {
    entry: VaultEntryExtended;
    active: boolean;
    onClick: () => void;
    reorderable: boolean;
    nativeDragEnabled: boolean;
    dragging: boolean;
    dragOver: boolean;
    dropAfter: boolean;
    handleProps: TouchHandleProps;
    onDragStart: () => void;
    onDragEnter: () => void;
    onDragEnd: () => void;
    onDrop: () => void;
    /** Déplacement au clavier (Alt+↑ / Alt+↓) d'une position vers le haut (-1) ou le bas (1). */
    onMove: (direction: -1 | 1) => void;
}

export default function EntryCard({
    entry, active, onClick,
    reorderable, nativeDragEnabled, dragging, dragOver, dropAfter, handleProps,
    onDragStart, onDragEnter, onDragEnd, onDrop, onMove,
}: EntryCardProps) {
    function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
        } else if (reorderable && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            onMove(e.key === "ArrowUp" ? -1 : 1);
        }
    }

    return (
        <div
            className={`entry-card ${active ? "active" : ""} ${dragging ? "dragging" : ""} ${dragOver ? "drag-over" : ""} ${dropAfter ? "drop-after" : ""}`}
            {...{ [ENTRY_ID_ATTRIBUTE]: entry.id }}
            // Carte utilisable au clavier : Entrée/Espace l'ouvre, Alt+↑/↓ la
            // déplace (alternative au glisser-déposer).
            role="button"
            tabIndex={0}
            aria-current={active ? "true" : undefined}
            aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
            onKeyDown={handleKeyDown}
            onClick={onClick}
            // Sur Android, un appui long lancerait le glisser natif et
            // interromprait le geste tactile en cours sur la poignée.
            draggable={reorderable && nativeDragEnabled}
            onDragStart={(e) => {
                // Lu par les dossiers de la barre latérale, où la carte peut être déposée.
                e.dataTransfer.setData(ENTRY_DRAG_TYPE, entry.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart();
            }}
            onDragEnter={onDragEnter}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={onDragEnd}
            onDrop={(e) => { e.preventDefault(); onDrop(); }}
        >
            {reorderable && (
                <span className="entry-drag-handle" title="Glisser pour réordonner (ou Alt+↑ / Alt+↓)" aria-hidden="true" {...handleProps}>
                    <GripVertical size={14} strokeWidth={2} />
                </span>
            )}
            <div className={`entry-icon-wrap cat-${entry.category}`}>
                {getInitial(entry)}
            </div>
            <div className="entry-info">
                <div className="entry-label">{entry.label}</div>
                <div className="entry-username">
                    {entrySubtitle(entry)}
                    {entry.category === "login" && entry.totpSecret && (
                        <ShieldCheck size={11} strokeWidth={2} className="entry-2fa-badge" />
                    )}
                </div>
            </div>
            <div className="entry-date">{formatDate(entry.updatedAt, true)}</div>
        </div>
    );
}
