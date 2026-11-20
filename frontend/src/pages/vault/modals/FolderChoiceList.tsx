import { Check, Folder, FolderMinus } from "lucide-react";

export interface FolderChoice {
    /** null = « sans dossier ». */
    id: string | null;
    label: string;
    count?: number;
}

type FolderChoiceListProps = {
    choices: FolderChoice[];
    selectedId: string | null;
    disabled?: boolean;
    onChoose: (id: string | null) => void;
};

/** Liste de dossiers cliquables, le choix courant coché (modales « Déplacer vers… » et « Dossiers »). */
export default function FolderChoiceList({ choices, selectedId, disabled = false, onChoose }: FolderChoiceListProps) {
    return (
        <ul className="folder-choices">
            {choices.map((choice) => {
                const isSelected = choice.id === selectedId;
                const Icon = choice.id === null ? FolderMinus : Folder;
                return (
                    <li key={choice.id ?? "none"}>
                        <button
                            type="button"
                            className={`folder-choice ${isSelected ? "selected" : ""}`}
                            aria-current={isSelected ? "true" : undefined}
                            disabled={disabled}
                            onClick={() => onChoose(choice.id)}
                        >
                            <Icon size={15} strokeWidth={2} aria-hidden="true" />
                            <span className="folder-choice-label">{choice.label}</span>
                            {choice.count !== undefined && <span className="folder-choice-count">{choice.count}</span>}
                            {isSelected && <Check className="folder-choice-check" size={14} strokeWidth={2.25} aria-hidden="true" />}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
