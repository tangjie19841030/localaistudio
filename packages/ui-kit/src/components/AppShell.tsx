import type { ReactNode } from "react";
import { tokensToCssVars } from "../tokens";

export interface AppShellProps {
  tokens: import("@studio/schema-core").Tokens;
  title: string;
  sidebar: boolean;
  children?: ReactNode;
  /** Schema node id, emitted as data-studio-id so a DOM-level visual issue
   *  maps back to the Schema node that produced it. Injected by codegen. */
  studioId?: string;
}

export const componentType = "AppShell";

/** App frame: brand top bar + optional left nav rail + content area. */
export default function AppShell({ tokens, title, sidebar, children, studioId }: AppShellProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      style={{
        ...tokensToCssVars(tokens),
        fontFamily: "var(--studio-font-sans)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        color: "var(--studio-color-text)",
        backgroundColor: "var(--studio-color-surface)",
      }}
    >
      <header
        className="flex items-center gap-3 px-5 py-3"
        style={{
          backgroundColor: "var(--studio-color-brand)",
          color: "#FFFFFF",
          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
        }}
      >
        <span
          aria-hidden
          className="inline-block h-6 w-6 shrink-0 rounded-md"
          style={{ backgroundColor: "rgba(255,255,255,0.22)" }}
        />
        <span className="text-base font-semibold tracking-tight">{title}</span>
      </header>
      <div className="flex flex-1">
        {sidebar && (
          <aside
            aria-label="侧栏"
            className="w-52 shrink-0 p-3"
            style={{
              backgroundColor: "var(--studio-color-surface)",
              borderRight: "1px solid var(--studio-color-border)",
            }}
          >
            <div
              className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--studio-color-muted)" }}
            >
              导航
            </div>
            <div
              className="rounded-[var(--studio-radius-control)] px-2 py-1.5 text-sm font-medium"
              style={{
                backgroundColor: "var(--studio-color-brand-soft)",
                color: "var(--studio-color-brand)",
              }}
            >
              {title}
            </div>
          </aside>
        )}
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
