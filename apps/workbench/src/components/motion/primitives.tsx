import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants,
} from "motion/react";
import {
  backdropVariants,
  collapseVariants,
  drawerVariants,
  EASE_IN_OUT,
  EASE_OUT,
  modalSurfaceVariants,
  pageVariants,
  paletteSurfaceVariants,
  staggerDelay,
} from "./presets";

/**
 * 系统开启"减少动态效果"时，所有变体退化为纯 opacity 的瞬时切换。
 * 与 main.tsx 的 <MotionConfig reducedMotion="user"> 及 index.css 的
 * prefers-reduced-motion 块构成三层兜底。
 */
export function useZeroable(variants: Variants): Variants {
  const reduce = useReducedMotion();
  return useMemo<Variants>(() => {
    if (!reduce) return variants;
    const instant = { transition: { duration: 0 } };
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, ...instant },
      exit: { opacity: 0, ...instant },
    };
  }, [reduce, variants]);
}

/**
 * 条件挂载的进出场包装：<Presence when={open}>…</Presence>。
 * 子树须为带 exit 的 motion 元素（可包在带 key 的 Fragment 里）。
 */
export function Presence({ when, children }: { when: boolean; children: ReactNode }) {
  return <AnimatePresence initial={false}>{when ? children : null}</AnimatePresence>;
}

export interface OverlayBackdropProps
  extends Omit<HTMLMotionProps<"div">, "className" | "onClick" | "children"> {
  open: boolean;
  /** z-index 工具类，如 "z-50" / "z-[60]"。 */
  z: string;
  /** 布局/底色类，如 "flex items-center justify-center bg-black/40"。 */
  className?: string;
  /** 不传 = 禁止点遮罩关闭（设置弹窗）。 */
  onBackdropClick?: () => void;
  children?: ReactNode;
}

/** 全屏遮罩层：纯透明度进出场。 */
export function OverlayBackdrop({
  open,
  z,
  className,
  onBackdropClick,
  children,
  ...rest
}: OverlayBackdropProps) {
  const variants = useZeroable(backdropVariants);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          {...rest}
          className={`fixed inset-0 ${z} ${className ?? ""}`}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onBackdropClick}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface ModalSurfaceProps extends HTMLMotionProps<"div"> {
  /** 顶部锚定面板（命令面板）使用更轻的缩放位移。 */
  palette?: boolean;
}

/** 居中/锚定弹层面板：scale + y 进出场。 */
export function ModalSurface({ palette = false, ...props }: ModalSurfaceProps) {
  const variants = useZeroable(palette ? paletteSurfaceVariants : modalSurfaceVariants);
  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      {...props}
    />
  );
}

export interface DrawerPanelProps extends HTMLMotionProps<"aside"> {
  side: "left" | "right";
}

/** 窄屏抽屉面板：纯横向滑动，方向由 --drawer-from 控制。 */
export function DrawerPanel({ side, style, ...props }: DrawerPanelProps) {
  const variants = useZeroable(drawerVariants);
  const mergedStyle = {
    "--drawer-from": side === "left" ? "-100%" : "100%",
    ...style,
  } as CSSProperties;
  return (
    <motion.aside
      style={mergedStyle}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      {...props}
    />
  );
}

/**
 * 页面切换壳（首页 ↔ 工作台）：mode="wait" 先出后进；
 * initial={false} 保证首屏不演入场动画（首页继续用自己的 .reveal）。
 */
export function PageShell({ pageKey, className, children }: {
  pageKey: string;
  className?: string;
  children: ReactNode;
}) {
  const variants = useZeroable(pageVariants);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={className ?? "h-screen overflow-y-auto"}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** 高度折叠容器（height 0 ↔ auto + opacity）。 */
export function Collapse({ open, className, children }: {
  open: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const variants = useZeroable(collapseVariants);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={`overflow-hidden ${className ?? ""}`}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface RevealItemProps extends HTMLMotionProps<"li"> {
  /** 在列表中的序号，驱动 stagger（超过 6 项截断）。 */
  index?: number;
  /** rise = 上浮淡入（低频列表）；fade = 仅淡入（高频/拖拽列表）。 */
  variant?: "fade" | "rise";
}

/** 列表项挂载入场。退场仅 opacity；禁用 layout（不做重排 FLIP）。 */
export function RevealItem({ index = 0, variant = "fade", ...props }: RevealItemProps) {
  const reduce = useReducedMotion();
  const variants = useMemo<Variants>(() => {
    if (reduce) {
      return {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0 } },
        exit: { opacity: 0, transition: { duration: 0 } },
      };
    }
    const duration = variant === "rise" ? 0.16 : 0.12;
    const ease = variant === "rise" ? EASE_OUT : EASE_IN_OUT;
    return {
      hidden: variant === "rise" ? { opacity: 0, y: 6 } : { opacity: 0 },
      visible: (custom: number = 0) => ({
        opacity: 1,
        ...(variant === "rise" ? { y: 0 } : {}),
        transition: { duration, ease, delay: staggerDelay(custom) },
      }),
      exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_IN_OUT } },
    };
  }, [reduce, variant]);
  return (
    <motion.li
      custom={index}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      {...props}
    />
  );
}
