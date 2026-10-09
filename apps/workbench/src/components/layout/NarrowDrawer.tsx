import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import { DrawerPanel, useZeroable, backdropVariants } from "../motion";

const openDrawerStack: string[] = [];
const MAX_FALLBACK_FOCUS_ATTEMPTS = 8;
const FALLBACK_FOCUS_TIMEOUT_MS = 500;

export interface NarrowDrawerProps {
  side: "left" | "right";
  /** Accessible name for the dialog, e.g. "需求". */
  label: string;
  onClose: () => void;
  /** Resolve a visible editor target when the narrow trigger is also gone. */
  focusFallback?: () => HTMLElement | null;
  children: ReactNode;
}

/**
 * Overlay drawer for narrow (<1024px) viewports: fixed-width rail sliding over
 * a click-to-close backdrop. Esc closes; both live inside the relative content
 * row so the overflow-hidden root never gains horizontal scroll.
 */
export function NarrowDrawer({ side, label, onClose, focusFallback, children }: NarrowDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const focusFallbackRef = useRef(focusFallback);
  const focusInsideRef = useRef(false);
  const lastFocusedInDrawerRef = useRef<HTMLElement | null>(null);
  const restoreRequestedRef = useRef(false);
  const restoreScheduledRef = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** Exit 动画期间防重入：吞掉二次 Esc/Tab/遮罩点击，避免 toggle 语义下抽屉被重新打开。 */
  const closingRef = useRef(false);
  const headingId = useId();
  const onCloseRef = useRef(onClose);
  const backdropMotion = useZeroable(backdropVariants);

  focusFallbackRef.current = focusFallback;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const scheduleRestoreFocus = (restoreTarget: HTMLElement | null, activeAtSchedule: Element | null): void => {
    if (!restoreTarget?.isConnected || restoreScheduledRef.current) return;
    restoreScheduledRef.current = true;
    const restoreFocus = (): void => {
      if (!restoreTarget.isConnected) return;
      const activeNow = document.activeElement;
      if (activeNow !== activeAtSchedule && activeNow !== document.body) return;
      restoreTarget.focus();
    };
    restoreFocus();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreFocus();
        restoreScheduledRef.current = false;
      });
    });
  };

  const scheduleFallbackFocus = (activeAtSchedule: Element | null): void => {
    if (!focusFallbackRef.current || restoreScheduledRef.current) return;
    restoreScheduledRef.current = true;
    let attempts = 0;
    let observer: MutationObserver | null = null;
    let timeoutId: number | null = null;
    const finish = (): void => {
      observer?.disconnect();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      restoreScheduledRef.current = false;
    };
    const restoreFocus = (): boolean => {
      const fallbackTarget = focusFallbackRef.current?.();
      if (!fallbackTarget?.isConnected) return false;
      const activeNow = document.activeElement;
      if (activeNow !== activeAtSchedule && activeNow !== document.body) return true;
      fallbackTarget.focus();
      return true;
    };
    const retry = (): void => {
      if (restoreFocus()) return finish();
      if (attempts >= MAX_FALLBACK_FOCUS_ATTEMPTS) return finish();
      attempts += 1;
      requestAnimationFrame(retry);
    };
    if (typeof MutationObserver === "function") {
      observer = new MutationObserver(retry);
      observer.observe(document.body, { childList: true, subtree: true });
      timeoutId = window.setTimeout(finish, FALLBACK_FOCUS_TIMEOUT_MS);
    }
    retry();
  };

  const closeDrawer = (): void => {
    // 退场动画（约 160ms）内组件仍在 DOM：立即置 inert 移出 a11y/焦点链，
    // 并让后续 Esc/Tab/遮罩点击全部短路。
    if (closingRef.current) return;
    closingRef.current = true;
    drawerRef.current?.setAttribute("inert", "");
    const activeElement = document.activeElement;
    const activeInDrawer = activeElement instanceof HTMLElement && drawerRef.current?.contains(activeElement);
    const restoreTarget =
      activeInDrawer ? restoreFocusRef.current : null;
    if (activeInDrawer && restoreTarget && activeElement instanceof HTMLElement) {
      restoreRequestedRef.current = true;
      activeElement.blur();
    }
    onCloseRef.current();
    if (restoreRequestedRef.current) {
      const activeAfterClose = document.activeElement;
      if (
        activeAfterClose instanceof HTMLElement &&
        activeAfterClose !== document.body &&
        activeAfterClose !== restoreTarget
      ) {
        restoreRequestedRef.current = false;
      } else {
        restoreRequestedRef.current = false;
        scheduleRestoreFocus(restoreTarget, activeAfterClose);
      }
    }
  };

  useLayoutEffect(() => {
    const drawerNode = drawerRef.current;
    return () => {
      const activeElement = document.activeElement;
      const focusedInDrawer =
        activeElement instanceof HTMLElement && drawerNode?.contains(activeElement)
          ? activeElement
          : focusInsideRef.current
            ? lastFocusedInDrawerRef.current
            : null;
      if (focusedInDrawer) {
        // Blur before React removes the focused control so native consumers
        // observe the same lifecycle as a user initiated focus change.
        if (focusedInDrawer.isConnected && document.activeElement === focusedInDrawer) {
          focusedInDrawer.blur();
        }
      }
    };
  }, [headingId]);

  useEffect(() => {
    openDrawerStack.push(headingId);
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawerNode = drawerRef.current;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      const inside = target instanceof HTMLElement && (drawerNode?.contains(target) ?? false);
      focusInsideRef.current = inside;
      lastFocusedInDrawerRef.current = inside ? target : null;
    };
    document.addEventListener("focusin", onFocusIn);
    focusInsideRef.current = drawerNode?.contains(document.activeElement) ?? false;
    closeRef.current?.focus();

    const getFocusable = (): HTMLElement[] =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => {
        if (element instanceof HTMLInputElement && element.type === "hidden") return false;
        if (element.hasAttribute("hidden")) return false;
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    const onKey = (e: KeyboardEvent): void => {
      // 退场中：Esc 与 Tab 焦点圈全部封死（backdrop 点击经 closeDrawer 幂等短路）。
      if (closingRef.current) return;
      if (e.key === "Escape") {
        if (openDrawerStack[openDrawerStack.length - 1] !== headingId) return;
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (e.key !== "Tab") return;
      if (openDrawerStack[openDrawerStack.length - 1] !== headingId) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        drawerRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!drawerRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      const index = openDrawerStack.indexOf(headingId);
      if (index >= 0) openDrawerStack.splice(index, 1);
      const activeElement = document.activeElement;
      const stillOwnsFocus = drawerNode?.contains(activeElement) || focusInsideRef.current;
      const restoreTarget = restoreFocusRef.current;
      const shouldRestoreFocus = restoreRequestedRef.current || stillOwnsFocus;
      if (!shouldRestoreFocus || restoreScheduledRef.current) return;

      const activeAtCleanup = activeElement;
      if (restoreTarget?.isConnected) {
        scheduleRestoreFocus(restoreTarget, activeAtCleanup);
      } else {
        scheduleFallbackFocus(activeAtCleanup);
      }
    };
  }, [headingId]);

  return (
    <>
      <motion.div
        data-testid="narrow-backdrop"
        aria-hidden
        variants={backdropMotion}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="absolute inset-0 z-30 bg-black/40"
        onClick={closeDrawer}
      />
      <DrawerPanel
        ref={drawerRef}
        side={side}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-label={label}
        tabIndex={-1}
        className={`absolute inset-y-0 z-50 flex flex-col overflow-hidden bg-rail shadow-pop ${
          side === "left"
            ? "left-0 w-72 max-w-[85vw] border-r border-hairline"
            : "right-0 w-80 max-w-[85vw] border-l border-hairline"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
          <h2 id={headingId} className="text-sm font-semibold text-ink">
            {label}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={`关闭${label}`}
            title={`关闭${label}`}
            onClick={closeDrawer}
            className="studio-transition inline-flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-ink-muted hover:bg-surface hover:text-ink"
          >
            ×
          </button>
        </div>
        {children}
      </DrawerPanel>
    </>
  );
}
