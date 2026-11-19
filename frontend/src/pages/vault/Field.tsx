import type { ReactNode } from "react";

interface FieldProps {
    label: string;
    children: ReactNode;
}

export default function Field({ label, children }: FieldProps) {
    return (
        <div className="detail-field">
            <div className="field-label">{label}</div>
            <div className="field-content">{children}</div>
        </div>
    );
}
