export interface TextProps {
  content: string;
  muted?: boolean;
  studioId?: string;
}

export const componentType = "Text";

/** Paragraph text; muted variant uses the muted token color. */
export default function Text({ content, muted, studioId }: TextProps) {
  return (
    <p
      data-component={componentType}
      data-studio-id={studioId}
      className={muted ? "text-sm text-[var(--studio-color-muted)]" : "text-sm"}
    >
      {content}
    </p>
  );
}
