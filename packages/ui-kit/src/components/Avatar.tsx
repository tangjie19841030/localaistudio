export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  name?: string;
  src?: string;
  size?: AvatarSize;
  studioId?: string;
}

export const componentType = "Avatar";

const SIZE_STYLE: Record<AvatarSize, { px: number; text: number }> = {
  sm: { px: 24, text: 10 },
  md: { px: 32, text: 12 },
  lg: { px: 40, text: 14 },
};

/** Brand tint derived from tokens (no hard color): brand over surface. */
const BRAND_SOFT_BG = "color-mix(in srgb, var(--studio-color-brand) 14%, var(--studio-color-surface))";

function normalizeSize(size: unknown): AvatarSize {
  return size === "sm" || size === "lg" ? size : "md";
}

function normalizeName(name: unknown): string {
  return typeof name === "string" && name.trim() !== "" ? name.trim() : "张三";
}

function normalizeSrc(src: unknown): string {
  return typeof src === "string" && src.trim() !== "" ? src : "";
}

/** Avatar: src image (object-cover) or first-character initials on brand tint. */
export default function Avatar({ name = "张三", src = "", size = "md", studioId }: AvatarProps) {
  const s = SIZE_STYLE[normalizeSize(size)];
  const resolved = normalizeName(name);
  const image = normalizeSrc(src);
  return (
    <span
      data-component={componentType}
      data-studio-id={studioId}
      className="inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium"
      style={{
        width: s.px,
        height: s.px,
        fontSize: s.text,
        backgroundColor: image ? "transparent" : BRAND_SOFT_BG,
        color: "var(--studio-color-brand)",
      }}
    >
      {image ? <img src={image} alt={resolved} className="h-full w-full object-cover" /> : resolved.charAt(0)}
    </span>
  );
}
