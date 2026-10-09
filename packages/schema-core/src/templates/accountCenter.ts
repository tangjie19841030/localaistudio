import type { NodeRecord, StudioDocument } from "../document.js";
import { docOfPages, node } from "./types.js";

// ============================================================
// Account Center — 账号中心组合（个人中心 profile + 账号设置 settings）
// ============================================================

/** Profile top: shell, header, stat cards. */
function profileTop(docName: string): NodeRecord[] {
  return [
    node("ac-profile-root", "AppShell", { title: docName, sidebar: true }, [
      "ac-profile-header", "ac-profile-stats", "ac-profile-info",
      "ac-profile-activity", "ac-profile-favorites",
    ]),
    node("ac-profile-header", "Header", {
      title: "个人中心",
      subtitle: "林语 · 管理员 · 上次登录 2026-09-17 21:34",
    }),
    node("ac-profile-stats", "MetricGrid", { columns: 3 }, [
      "ac-profile-s1", "ac-profile-s2", "ac-profile-s3",
    ]),
    node("ac-profile-s1", "StatCard", { label: "参与项目", value: "24", delta: "+3 本季度", tone: "brand" }),
    node("ac-profile-s2", "StatCard", { label: "本月活跃", value: "26 天", delta: "连续打卡 11 天", tone: "success" }),
    node("ac-profile-s3", "StatCard", { label: "获得点赞", value: "1,892", delta: "+124 本月", tone: "warning" }),
  ];
}

/** Profile body: basic info card with avatar and key-value list. */
function profileInfo(): NodeRecord[] {
  return [
    node("ac-profile-info", "Section", { title: "基本信息", description: "" }, [
      "ac-profile-info-card",
    ]),
    node("ac-profile-info-card", "Card", { title: "账号资料", padded: true }, [
      "ac-profile-avatar-row", "ac-profile-keyval",
    ]),
    node("ac-profile-avatar-row", "Stack", { gap: 2, align: "start" }, [
      "ac-profile-avatar", "ac-profile-avatar-btn",
    ]),
    node("ac-profile-avatar", "Avatar", { name: "林语", src: "", size: "lg" }),
    node("ac-profile-avatar-btn", "Button", { label: "更换头像", variant: "secondary", size: "sm" }),
    node("ac-profile-keyval", "KeyValList", {
      items: [
        { key: "昵称", value: "林语" },
        { key: "邮箱", value: "linyu@yunshu.tech" },
        { key: "手机", value: "138****6621" },
        { key: "角色", value: "管理员" },
        { key: "时区", value: "UTC+8 北京" },
      ],
    }),
  ];
}

/** Profile tail: activity timeline and favorites list. */
function profileTail(): NodeRecord[] {
  return [
    node("ac-profile-activity", "Section", { title: "最近动态", description: "" }, [
      "ac-profile-timeline",
    ]),
    node("ac-profile-timeline", "Timeline", {
      items: [
        { title: "更新了「营销官网」的定价页", time: "09-17 20:12" },
        { title: "导出了「运营看板」的 React 工程", time: "09-16 18:40" },
        { title: "创建了项目「移动端 App 原型」", time: "09-14 09:05" },
        { title: "把「石墨灰」预设应用到了 3 个页面", time: "09-12 15:22" },
      ],
    }),
    node("ac-profile-favorites", "Section", { title: "我的收藏", description: "" }, [
      "ac-profile-fav-list",
    ]),
    node("ac-profile-fav-list", "List", {
      items: [
        {
          title: "组件库 v2.0 迁移指南",
          description: "58 个组件的破坏性变更清单",
          meta: "文档",
        },
        {
          title: "电商结账流程设计复盘",
          description: "转化率提升 12% 的三个改动",
          meta: "收藏",
        },
      ],
    }),
  ];
}

/** Settings top: shell, header, tabs and basic profile form. */
function settingsTop(docName: string): NodeRecord[] {
  return [
    node("ac-settings-root", "AppShell", { title: docName, sidebar: true }, [
      "ac-settings-header", "ac-settings-tabs", "ac-settings-basic",
      "ac-settings-security", "ac-settings-notify", "ac-settings-danger",
    ]),
    node("ac-settings-header", "Header", { title: "账号设置", subtitle: "资料、安全与通知偏好" }),
    node("ac-settings-tabs", "Tabs", { items: ["基本资料", "安全", "通知"], activeIndex: 0 }),
    node("ac-settings-basic", "Section", { title: "基本资料", description: "这些信息会展示给团队其他成员" }, [
      "ac-settings-form",
    ]),
    node("ac-settings-form", "Form", { title: "" }, ["ac-settings-grid"]),
    node("ac-settings-grid", "Grid", { columns: 2, gap: 4 }, [
      "ac-settings-f-name", "ac-settings-f-title", "ac-settings-f-email", "ac-settings-f-lang",
    ]),
    node("ac-settings-f-name", "FormField", { label: "显示名称", required: true, helpText: "" }, [
      "ac-settings-name",
    ]),
    node("ac-settings-name", "Input", { placeholder: "林语", type: "text" }),
    node("ac-settings-f-title", "FormField", { label: "职位", required: false, helpText: "" }, [
      "ac-settings-title",
    ]),
    node("ac-settings-title", "Input", { placeholder: "产品设计师", type: "text" }),
    node("ac-settings-f-email", "FormField", { label: "邮箱", required: true, helpText: "登录与通知共用" }, [
      "ac-settings-email",
    ]),
    node("ac-settings-email", "Input", { placeholder: "linyu@yunshu.tech", type: "email" }),
    node("ac-settings-f-lang", "FormField", { label: "界面语言", required: false, helpText: "" }, [
      "ac-settings-lang",
    ]),
    node("ac-settings-lang", "Select", {
      options: ["简体中文", "English", "日本語"],
      placeholder: "简体中文",
    }),
  ];
}

/** Settings bottom: password, two-factor, notifications and danger zone. */
function settingsBottom(): NodeRecord[] {
  return [
    node("ac-settings-security", "Section", { title: "安全", description: "" }, [
      "ac-settings-pass-form", "ac-settings-2fa",
    ]),
    node("ac-settings-pass-form", "Form", { title: "修改密码" }, [
      "ac-settings-f-old", "ac-settings-f-new", "ac-settings-pass-btn",
    ]),
    node("ac-settings-f-old", "FormField", { label: "当前密码", required: true, helpText: "" }, [
      "ac-settings-old",
    ]),
    node("ac-settings-old", "Input", { placeholder: "请输入当前密码", type: "password" }),
    node("ac-settings-f-new", "FormField", { label: "新密码", required: true, helpText: "至少 8 位，包含字母与数字" }, [
      "ac-settings-new",
    ]),
    node("ac-settings-new", "Input", { placeholder: "请设置新密码", type: "password" }),
    node("ac-settings-pass-btn", "Button", { label: "更新密码", variant: "primary", size: "md" }),
    node("ac-settings-2fa", "Switch", { label: "两步验证（App 动态码）", checked: true }),
    node("ac-settings-notify", "Section", { title: "通知偏好", description: "" }, [
      "ac-settings-notify-stack",
    ]),
    node("ac-settings-notify-stack", "Stack", { gap: 3, align: "stretch" }, [
      "ac-settings-n1", "ac-settings-n2", "ac-settings-n3",
    ]),
    node("ac-settings-n1", "Switch", { label: "评论与提及提醒", checked: true }),
    node("ac-settings-n2", "Switch", { label: "每周产品动态邮件", checked: false }),
    node("ac-settings-n3", "Switch", { label: "安全告警（推荐开启）", checked: true }),
    node("ac-settings-danger", "Section", { title: "危险区", description: "以下操作不可撤销" }, [
      "ac-settings-danger-stack",
    ]),
    node("ac-settings-danger-stack", "Stack", { gap: 3, align: "stretch" }, [
      "ac-settings-danger-alert", "ac-settings-danger-btn",
    ]),
    node("ac-settings-danger-alert", "Alert", {
      tone: "warning",
      title: "注销后所有项目与导出记录将被删除",
      description: "团队内的共享项目会转移给其他管理员。",
    }),
    node("ac-settings-danger-btn", "Button", { label: "注销账号", variant: "danger", size: "md" }),
  ];
}

/** Builds the two-page account center: profile + settings. */
export function buildAccountCenter(docName: string): StudioDocument {
  return docOfPages(docName, [
    {
      id: "ac-profile",
      name: "个人中心",
      rootId: "ac-profile-root",
      nodes: [...profileTop(docName), ...profileInfo(), ...profileTail()],
    },
    {
      id: "ac-settings",
      name: "账号设置",
      rootId: "ac-settings-root",
      nodes: [...settingsTop(docName), ...settingsBottom()],
    },
  ]);
}
