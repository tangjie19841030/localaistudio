export interface ImageProps {
  src: string;
  alt: string;
  studioId?: string;
}

export const componentType = "Image";

/** Image with dashed placeholder box when src is empty (never broken img). */
export default function Image({ src, alt, studioId }: ImageProps) {
  if (!src) {
    return (
      <div
        data-component={componentType}
        data-studio-id={studioId}
        className="flex h-40 w-full flex-col items-center justify-center rounded-[var(--studio-radius-card)] border border-dashed text-sm text-[var(--studio-color-muted)]"
        style={{ borderColor: "var(--studio-color-border)" }}
      >
        <span>🖼</span>
        <span>{alt}</span>
      </div>
    );
  }
  return (
    <img
      data-component={componentType}
      data-studio-id={studioId}
      src={src}
      alt={alt}
      className="h-auto w-full rounded-[var(--studio-radius-card)] border object-cover"
      style={{ borderColor: "var(--studio-color-border)" }}
    />
  );
}
