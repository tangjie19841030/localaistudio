export interface HeadingProps {
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  studioId?: string;
}

export const componentType = "Heading";

const SIZE_CLASS = [
  "text-4xl font-bold",
  "text-2xl font-bold",
  "text-xl font-semibold",
  "text-lg font-semibold",
  "text-base font-medium",
  "text-sm font-medium",
];

/** Heading element h1-h6 with size scale. */
export default function Heading({ text, level = 2, studioId }: HeadingProps) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag data-component={componentType} data-studio-id={studioId} className={SIZE_CLASS[level - 1]}>
      {text}
    </Tag>
  );
}
