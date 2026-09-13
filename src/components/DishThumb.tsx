import CategoryArt from "./CategoryArt";

interface Props {
  category: string;
  photo?: string;
  size?: "sm" | "md" | "card" | "lg" | "wide";
  scrim?: boolean;
}

const sizes = {
  sm: "w-12 h-12 rounded-lg",
  md: "w-16 h-16 rounded-xl",
  card: "w-20 h-20 rounded-xl",
  lg: "w-full aspect-[16/10] rounded-card",
  wide: "w-full aspect-[21/9] rounded-card",
};

export default function DishThumb({ category, photo, size = "md", scrim = false }: Props) {
  const compact = size !== "lg" && size !== "wide";
  return (
    <div className={`relative overflow-hidden border border-line bg-surface2 shrink-0 ${sizes[size]}`}>
      {photo ? (
        <>
          <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          {scrim && <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />}
        </>
      ) : (
        <CategoryArt category={category} compact={compact} />
      )}
    </div>
  );
}
