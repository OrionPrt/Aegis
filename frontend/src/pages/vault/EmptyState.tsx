import { Shield } from "lucide-react";

export default function EmptyState({ search }: { search: string }) {
    return (
        <div className="empty-state">
            <Shield className="empty-icon" size={30} strokeWidth={1.5} />
            <p>{search ? `Aucun résultat pour "${search}"` : "Aucune entrée dans cette catégorie"}</p>
        </div>
    );
}
