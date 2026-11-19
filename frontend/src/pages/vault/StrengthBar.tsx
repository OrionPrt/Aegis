const STRENGTH_LABELS = ["Très faible", "Faible", "Correct", "Fort", "Très fort"];
const STRENGTH_COLORS = ["#C85050", "#E8803A", "#C9A84C", "#70B870", "#50C890"];

interface StrengthBarProps {
    score: number;
    entropy: number;
}

export default function StrengthBar({ score, entropy }: StrengthBarProps) {
    return (
        <div className="strength-wrap">
            <div className="strength-bars">
                {[0, 1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        className="strength-bar"
                        style={{ background: i <= score ? STRENGTH_COLORS[score] : "#1E2233" }}
                    />
                ))}
            </div>
            <span className="strength-label" style={{ color: STRENGTH_COLORS[score] }}>
        {STRENGTH_LABELS[score]} · {entropy} bits
      </span>
        </div>
    );
}
