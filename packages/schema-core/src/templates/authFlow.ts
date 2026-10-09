import type { NodeRecord, StudioDocument } from "../document.js";
import { docOfPages, node } from "./types.js";

// ============================================================
// Auth Flow — 认证流程组合（登录 login + 注册 register）
// ============================================================

/** Login page: brand heading, card form, third-party entries. */
function loginNodes(docName: string): NodeRecord[] {
  return [
    node("au-login-root", "Container", { maxWidth: "sm" }, [
      "au-login-heading", "au-login-card", "au-login-switch",
    ]),
    node("au-login-heading", "Heading", { text: docName, level: 1 }),
    node("au-login-card", "Card", { title: "登录账号", padded: true }, [
      "au-login-form", "au-login-alt",
    ]),
    node("au-login-form", "Form", { title: "" }, [
      "au-login-f-email", "au-login-f-pass", "au-login-row", "au-login-submit",
    ]),
    node("au-login-f-email", "FormField", { label: "邮箱", required: true, helpText: "" }, [
      "au-login-email",
    ]),
    node("au-login-email", "Input", { placeholder: "name@example.com", type: "email" }),
    node("au-login-f-pass", "FormField", { label: "密码", required: true, helpText: "" }, [
      "au-login-pass",
    ]),
    node("au-login-pass", "Input", { placeholder: "请输入密码", type: "password" }),
    node("au-login-row", "Grid", { columns: 2, gap: 2 }, [
      "au-login-remember", "au-login-forgot",
    ]),
    node("au-login-remember", "Checkbox", { label: "记住我", checked: true }),
    node("au-login-forgot", "Text", { content: "忘记密码？", muted: true }),
    node("au-login-submit", "Button", { label: "登录", variant: "primary", size: "lg" }),
    node("au-login-alt", "Stack", { gap: 3, align: "stretch" }, [
      "au-login-divider", "au-login-otp", "au-login-sso",
    ]),
    node("au-login-divider", "Divider", { orientation: "horizontal", label: "或使用以下方式" }),
    node("au-login-otp", "Button", { label: "手机验证码登录", variant: "secondary", size: "md" }),
    node("au-login-sso", "Button", { label: "企业 SSO 登录", variant: "secondary", size: "md" }),
    node("au-login-switch", "Text", { content: "还没有账号？创建一个新账号。", muted: true }),
  ];
}

/** Register page: promo alert and signup form with agreement checkbox. */
function registerNodes(docName: string): NodeRecord[] {
  return [
    node("au-register-root", "Container", { maxWidth: "sm" }, [
      "au-register-heading", "au-register-card", "au-register-switch",
    ]),
    node("au-register-heading", "Heading", { text: docName, level: 1 }),
    node("au-register-card", "Card", { title: "创建账号", padded: true }, [
      "au-register-promo", "au-register-form",
    ]),
    node("au-register-promo", "Alert", {
      tone: "info",
      title: "注册即送 14 天专业版试用",
      description: "无需绑定支付方式，到期自动降级为免费版。",
    }),
    node("au-register-form", "Form", { title: "" }, [
      "au-register-f-name", "au-register-f-email", "au-register-f-pass",
      "au-register-f-confirm", "au-register-agree", "au-register-submit",
    ]),
    node("au-register-f-name", "FormField", { label: "昵称", required: true, helpText: "" }, [
      "au-register-name",
    ]),
    node("au-register-name", "Input", { placeholder: "给自己起个名字", type: "text" }),
    node("au-register-f-email", "FormField", { label: "邮箱", required: true, helpText: "用于登录与找回密码" }, [
      "au-register-email",
    ]),
    node("au-register-email", "Input", { placeholder: "name@example.com", type: "email" }),
    node("au-register-f-pass", "FormField", { label: "密码", required: true, helpText: "至少 8 位，包含字母与数字" }, [
      "au-register-pass",
    ]),
    node("au-register-pass", "Input", { placeholder: "请设置密码", type: "password" }),
    node("au-register-f-confirm", "FormField", { label: "确认密码", required: true, helpText: "" }, [
      "au-register-confirm",
    ]),
    node("au-register-confirm", "Input", { placeholder: "再输入一次密码", type: "password" }),
    node("au-register-agree", "Checkbox", {
      label: "我已阅读并同意《服务条款》与《隐私政策》",
      checked: false,
    }),
    node("au-register-submit", "Button", { label: "注册", variant: "primary", size: "lg" }),
    node("au-register-switch", "Text", { content: "已有账号？返回登录。", muted: true }),
  ];
}

/** Builds the two-page auth flow: login + register. */
export function buildAuthFlow(docName: string): StudioDocument {
  return docOfPages(docName, [
    { id: "au-login", name: "登录", rootId: "au-login-root", nodes: loginNodes(docName) },
    {
      id: "au-register",
      name: "注册",
      rootId: "au-register-root",
      nodes: registerNodes(docName),
    },
  ]);
}
