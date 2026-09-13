import Medallion from "./Medallion";

interface Props {
  seed: string;
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

export default function DishThumb({ seed, photo, size = "md", scrim = false }: Props) {
  const box = `relative overflow-hidden border border-line bg-surface2 shrink-0 ${sizes[size]}`;

  if (photo) {
    return (
      <div className={box}>
        <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: "saturate(0.85)" }} loading="lazy" />
        {scrim && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />}
      </div>
    );
  }

  return (
    <div className={`${box} flex items-center justify-center`} aria-hidden="true">
      <Medallion
        seed={seed}
        label={seed}
        className={size === "lg" || size === "wide" ? "h-[64%] aspect-square" : "w-[82%] h-[82%]"}
      />
    </div>
  );
}
