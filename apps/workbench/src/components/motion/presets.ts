import type { Transition, Variants } from "motion/react";

/**
 * 全站动效预设（Linear 风：快、短、不过冲）。
 * 曲线与 index.css 的 --ease-out-soft / --ease-in-out-soft 同源，
 * 时长对齐 --duration-control(150ms) / --duration-panel(180ms)。
 * 只动 opacity / transform；禁止 layout/layoutId（Monaco、iframe、画布承受不起 FLIP）。
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

export const tBackdrop: Transition = { duration: 0.15, ease: EASE_IN_OUT };
export const tBackdropExit: Transition = { duration: 0.13, ease: EASE_IN_OUT };
export const tModal: Transition = { duration: 0.18, ease: EASE_OUT };
export const tModalExit: Transition = { duration: 0.13, ease: EASE_IN_OUT };
export const tPalette: Transition = { duration: 0.16, ease: EASE_OUT };
export const tDrawer: Transition = { duration: 0.2, ease: EASE_OUT };
export const tDrawerExit: Transition = { duration: 0.16, ease: EASE_IN_OUT };
export const tPage: Transition = { duration: 0.16, ease: EASE_OUT };
export const tPageExit: Transition = { duration: 0.12, ease: EASE_IN_OUT };
export const tItem: Transition = { duration: 0.16, ease: EASE_OUT };
export const tFade: Transition = { duration: 0.12, ease: EASE_IN_OUT };
export const tCollapse: Transition = { duration: 0.18, ease: EASE_OUT };
export const tCollapseExit: Transition = { duration: 0.15, ease: EASE_IN_OUT };

/** 遮罩：纯透明度。 */
export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tBackdrop },
  exit: { opacity: 0, transition: tBackdropExit },
};

/** 居中模态（设置/截图查看）：96% 缩放 + 6px 上浮。 */
export const modalSurfaceVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  visible: { opacity: 1, scale: 1, y: 0, transition: tModal },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: tModalExit },
};

/** 顶部锚定面板（命令面板）：更轻的 98% + 上移 4px。 */
export const paletteSurfaceVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: tPalette },
  exit: { opacity: 0, scale: 0.98, y: -2, transition: tModalExit },
};

/** 抽屉：纯横向滑动；方向由 --drawer-from CSS 变量给（-100% / 100%）。 */
export const drawerVariants: Variants = {
  hidden: { x: "var(--drawer-from)" },
  visible: { x: 0, transition: tDrawer },
  exit: { x: "var(--drawer-from)", transition: tDrawerExit },
};

/** 首页 ↔ 工作台页面切换。 */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: tPage },
  exit: { opacity: 0, y: 4, transition: tPageExit },
};

/** 列表项：上浮 6px（版本列表等低频列表）。 */
export const riseItemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: tItem },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_IN_OUT } },
};

/** 列表项：仅淡入（运行日志、图层树等高频/拖拽场景）。 */
export const fadeItemVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tFade },
  exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_IN_OUT } },
};

/** 折叠面板：height 0 ↔ auto + 轻透明度。 */
export const collapseVariants: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: { height: "auto", opacity: 1, transition: tCollapse },
  exit: { height: 0, opacity: 0, transition: tCollapseExit },
};

/**
 * 列表项 stagger 间隔（秒）；超过 STAGGER_CAP 项不再追加延迟，
 * 避免长列表首项等待。20ms × 6 ≈ 120ms 尾部。
 */
export const STAGGER_STEP = 0.02;
export const STAGGER_CAP = 6;

export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), STAGGER_CAP) * STAGGER_STEP;
}
