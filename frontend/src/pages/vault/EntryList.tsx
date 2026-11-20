import { useRef, useState } from "react";
import { useTouchReorder } from "../../hooks/useTouchReorder";
import type { DropPlacement } from "../../lib/reorder";
import EmptyState from "./EmptyState";
import EntryCard from "./EntryCard";
import type { VaultEntryExtended } from "./types";

interface EntryListProps {
    entries: VaultEntryExtended[];
    selectedId: string | undefined;
    search: string;
    saving: boolean;
    onSelect: (entry: VaultEntryExtended) => void;
    onReorder: (draggedEntryId: string, targetId: string, placement?: DropPlacement) => void;
}

/**
 * Liste des entrées, réordonnable par glisser-déposer natif (souris) ou
 * par geste tactile sur la poignée (useTouchReorder).
 */
export default function EntryList({ entries, selectedId, search, saving, onSelect, onReorder }: EntryListProps) {
    const [draggedId,  setDraggedId]  = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const entryListRef = useRef<HTMLDivElement>(null);

    const touchReorder = useTouchReorder({
        listRef: entryListRef,
        // Une sauvegarde en cours repartirait d'une liste bientôt périmée.
        isDisabled: saving,
        onDrop: (draggedEntryId, target) => {
            onReorder(draggedEntryId, target.id, target.placement);
        },
    });

    function endNativeDrag() {
        setDraggedId(null);
        setDragOverId(null);
    }

    return (
        <div className="entry-list" ref={entryListRef}>
            {entries.length === 0 ? (
                <EmptyState search={search} />
            ) : (
                entries.map((entry) => (
                    <EntryCard
                        key={entry.id}
                        entry={entry}
                        active={selectedId === entry.id}
                        onClick={() => onSelect(entry)}
                        reorderable={!search}
                        nativeDragEnabled={touchReorder.draggedId === null}
                        dragging={draggedId === entry.id || touchReorder.draggedId === entry.id}
                        dragOver={
                            (dragOverId === entry.id && draggedId !== entry.id) ||
                            touchReorder.dropTarget?.id === entry.id
                        }
                        dropAfter={touchReorder.dropTarget?.id === entry.id && touchReorder.dropTarget.placement === "after"}
                        handleProps={touchReorder.getHandleProps(entry.id)}
                        onDragStart={() => setDraggedId(entry.id)}
                        onDragEnter={() => { if (draggedId) setDragOverId(entry.id); }}
                        onDragEnd={endNativeDrag}
                        onDrop={() => {
                            if (draggedId) onReorder(draggedId, entry.id);
                            endNativeDrag();
                        }}
                    />
                ))
            )}
        </div>
    );
}
