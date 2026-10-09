import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi } from "vitest";

/**
 * motion/react 在 jsdom 下直通：AnimatePresence 变 Fragment（open 翻 false 即同步
 * 卸载，退出动画不延迟），motion.* 变对应原生标签（剥掉动画专用 props，透传
 * ref/事件/aria/style）。真实动画时序不在单测内验证，避免 rAF 退出动画导致
 * "关闭即消失"类同步断言 flaky。
 */
vi.mock("motion/react", async () => {
  const React = await import("react");

  const STRIP_PROPS = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "custom",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
    "viewport",
    "layout",
    "layoutId",
    "layoutDependency",
    "drag",
    "dragConstraints",
    "dragElastic",
    "dragMomentum",
    "onViewportEnter",
    "onViewportLeave",
    "onAnimationStart",
    "onAnimationComplete",
    "onAnimationCancel",
  ]);

  const cache = new Map<string, unknown>();
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        if (!cache.has(tag)) {
          cache.set(
            tag,
            React.forwardRef(function MotionMock(props: Record<string, unknown>, ref: unknown) {
              const safe: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(props)) {
                if (!STRIP_PROPS.has(key)) safe[key] = value;
              }
              return React.createElement(tag, { ...safe, ref });
            }),
          );
        }
        return cache.get(tag);
      },
    },
  );

  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    motion,
    AnimatePresence: Passthrough,
    MotionConfig: Passthrough,
    LayoutGroup: Passthrough,
    useReducedMotion: () => false,
    useScroll: () => ({ scrollY: { on: () => () => {} }, scrollYProgress: { on: () => () => {} } }),
    useTransform: () => () => 0,
  };
});
