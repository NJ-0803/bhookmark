interface Props {
  emoji: string;
  tint: string;
  photo?: string;
  size?: "sm" | "md" | "card" | "lg";
  scrim?: boolean;
}

const sizes = {
  sm: "w-12 h-12 text-xl rounded-lg",
  md: "w-16 h-16 text-2xl rounded-xl",
  card: "w-20 h-20 text-2xl rounded-xl",
  lg: "w-full aspect-[4/3] text-5xl rounded-card",
};

export default function DishThumb({ emoji, tint, photo, size = "md", scrim = false }: Props) {
  if (photo) {
    return (
      <div className={`relative overflow-hidden border border-line shrink-0 ${sizes[size]}`}>
        <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        {scrim && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />}
      </div>
    );
  }

  return (
    <div
      className={`bg-gradient-to-br ${tint} bg-surface2 flex items-center justify-center shrink-0 border border-line ${sizes[size]}`}
      aria-hidden="true"
    >
      <span style={{ filter: "saturate(1.1)" }}>{emoji}</span>
    </div>
  );
}
