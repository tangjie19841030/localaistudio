import { useThemeStore, type ThemePreference } from "../../state/themeStore";

/** 点击循环：浅色 → 深色 → 跟随系统 → 浅色。 */
const NEXT: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const LABEL: Record<ThemePreference, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  const common = {
    "aria-hidden": true as const,
    viewBox: "0 0 16 16",
    className: "h-3.5 w-3.5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (preference === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.8.8M11.8 11.8l.8.8M3.4 12.6l.8-.8M11.8 4.2l.8-.8" />
      </svg>
    );
  }
  if (preference === "dark") {
    return (
      <svg {...common}>
        <path d="M12.5 9.2A5 5 0 0 1 6.8 3.5 5.2 5.2 0 1 0 12.5 9.2z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M5 13.5h6M8 11.5v2" />
    </svg>
  );
}

/**
 * 顶栏主题切换：icon + 短标签，与撤销/重做 ghost 一致。
 * aria-label / title 保留完整中文，便于无障碍与测试。
 */
export function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <button
      type="button"
      aria-label={`主题：${LABEL[preference]}，点击切换`}
      title={`主题：${LABEL[preference]}`}
      className="studio-transition inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-rail hover:text-ink"
      onClick={() => setPreference(NEXT[preference])}
    >
      <ThemeIcon preference={preference} />
      <span className="hidden sm:inline">{LABEL[preference]}</span>
    </button>
  );
}
