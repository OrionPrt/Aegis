import { GripVertical, ShieldCheck } from "lucide-react";
import { ENTRY_ID_ATTRIBUTE } from "../../hooks/useTouchReorder";
import type { TouchHandleProps } from "../../hooks/useTouchReorder";
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
}

export default function EntryCard({
    entry, active, onClick,
    reorderable, nativeDragEnabled, dragging, dragOver, dropAfter, handleProps,
    onDragStart, onDragEnter, onDragEnd, onDrop,
}: EntryCardProps) {
    return (
        <div
            className={`entry-card ${active ? "active" : ""} ${dragging ? "dragging" : ""} ${dragOver ? "drag-over" : ""} ${dropAfter ? "drop-after" : ""}`}
            {...{ [ENTRY_ID_ATTRIBUTE]: entry.id }}
            onClick={onClick}
            // Sur Android, un appui long lancerait le glisser natif et
            // interromprait le geste tactile en cours sur la poignée.
            draggable={reorderable && nativeDragEnabled}
            onDragStart={onDragStart}
            onDragEnter={onDragEnter}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={onDragEnd}
            onDrop={(e) => { e.preventDefault(); onDrop(); }}
        >
            {reorderable && (
                <span className="entry-drag-handle" title="Glisser pour réordonner" {...handleProps}>
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
