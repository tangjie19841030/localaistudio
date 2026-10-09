import type { NodeRecord, StudioDocument } from "../document.js";
import { docOfPages, node } from "./types.js";

// ============================================================
// Shop Flow — 电商购物流程（商品列表 + 购物车 + 结账）
// ============================================================

/** Product list top: nav, header, search, category tabs. */
function listTop(docName: string): NodeRecord[] {
  return [
    node("sf-list-root", "Container", { maxWidth: "lg" }, [
      "sf-list-nav", "sf-list-head", "sf-list-search", "sf-list-tabs",
      "sf-list-products", "sf-list-page", "sf-list-footer",
    ]),
    node("sf-list-nav", "Nav", { items: ["首页", "全部商品", "新品上市", "购物车", "我的订单"] }),
    node("sf-list-head", "Header", { title: docName, subtitle: "为开发者甄选的效率装备" }),
    node("sf-list-search", "SearchInput", { placeholder: "搜索商品名称或型号…", value: "" }),
    node("sf-list-tabs", "Tabs", {
      items: ["全部", "键盘", "鼠标", "显示器", "桌面配件"],
      activeIndex: 0,
    }),
  ];
}

/** Product grid: three cards with description, price badge and add-to-cart. */
function listProducts(): NodeRecord[] {
  const items: NodeRecord[] = [
    node("sf-list-products", "Section", { title: "热销商品", description: "按销量排序" }, [
      "sf-list-grid",
    ]),
    node("sf-list-grid", "Grid", { columns: 3, gap: 4 }, [
      "sf-list-p1", "sf-list-p2", "sf-list-p3",
    ]),
  ];
  const cards: Array<[string, string, string]> = [
    ["87 键三模机械键盘", "Gasket 结构 · RGB 背光 · 全键热插拔", "¥399"],
    ["人体工学垂直鼠标", "2.4G 双模 · 静音微动 · 适配中小手型", "¥249"],
    ["27 英寸 4K 专业显示器", "Type-C 90W 反充 · 出厂校色", "¥2,299"],
  ];
  cards.forEach(([title, desc, price], idx) => {
    const p = `sf-list-p${idx + 1}`;
    items.push(
      node(p, "Card", { title, padded: true }, [`${p}-desc`, `${p}-price`, `${p}-btn`]),
      node(`${p}-desc`, "Text", { content: desc, muted: true }),
      node(`${p}-price`, "Badge", { label: price, tone: "brand" }),
      node(`${p}-btn`, "Button", { label: "加入购物车", variant: "primary", size: "sm" }),
    );
  });
  return items;
}

/** Product list close: pagination and footer. */
function listClose(): NodeRecord[] {
  return [
    node("sf-list-page", "Pagination", { page: 1, pageCount: 12 }),
    node("sf-list-footer", "Footer", {
      columns: [
        { title: "购物", links: ["全部商品", "配送说明", "退换政策"] },
        { title: "服务", links: ["帮助中心", "联系客服", "保修查询"] },
      ],
      copyright: "© 2026 极客外设商城",
    }),
  ];
}

/** Cart top: header and item table. */
function cartTop(docName: string): NodeRecord[] {
  return [
    node("sf-cart-root", "Container", { maxWidth: "md" }, [
      "sf-cart-head", "sf-cart-items", "sf-cart-coupon", "sf-cart-summary",
      "sf-cart-actions", "sf-cart-notice",
    ]),
    node("sf-cart-head", "Header", { title: docName, subtitle: "购物车 · 4 件商品" }),
    node("sf-cart-items", "Section", { title: "商品清单", description: "" }, ["sf-cart-table"]),
    node("sf-cart-table", "Table", {
      columns: ["商品", "单价", "数量", "小计"],
      rows: [
        ["87 键三模机械键盘", "¥399", "1", "¥399"],
        ["人体工学垂直鼠标", "¥249", "2", "¥498"],
        ["27 英寸 4K 专业显示器", "¥2,299", "1", "¥2,299"],
      ],
    }),
  ];
}

/** Cart bottom: coupon, fee summary, actions and shipping notice. */
function cartBottom(): NodeRecord[] {
  return [
    node("sf-cart-coupon", "Card", { title: "优惠券", padded: true }, ["sf-cart-coupon-row"]),
    node("sf-cart-coupon-row", "Stack", { gap: 2, align: "stretch" }, [
      "sf-cart-coupon-input", "sf-cart-coupon-btn",
    ]),
    node("sf-cart-coupon-input", "Input", { placeholder: "输入优惠码，如 GEEK2026", type: "text" }),
    node("sf-cart-coupon-btn", "Button", { label: "兑换", variant: "secondary", size: "md" }),
    node("sf-cart-summary", "Card", { title: "费用明细", padded: true }, ["sf-cart-summary-list"]),
    node("sf-cart-summary-list", "KeyValList", {
      items: [
        { key: "商品合计", value: "¥3,196" },
        { key: "运费", value: "免运费" },
        { key: "优惠", value: "-¥100（新人券）" },
        { key: "应付总额", value: "¥3,096" },
      ],
    }),
    node("sf-cart-actions", "Stack", { gap: 2, align: "stretch" }, [
      "sf-cart-checkout", "sf-cart-continue",
    ]),
    node("sf-cart-checkout", "Button", { label: "去结算", variant: "primary", size: "lg" }),
    node("sf-cart-continue", "Button", { label: "继续购物", variant: "ghost", size: "md" }),
    node("sf-cart-notice", "Alert", {
      tone: "info",
      title: "满 299 元即享包邮",
      description: "偏远地区（新疆、西藏等）需补 10 元运费，结算时自动计算。",
    }),
  ];
}

/** Checkout top: steps indicator and shipping form. */
function checkoutTop(docName: string): NodeRecord[] {
  return [
    node("sf-checkout-root", "Container", { maxWidth: "md" }, [
      "sf-checkout-head", "sf-checkout-steps", "sf-checkout-address",
      "sf-checkout-payment", "sf-checkout-summary", "sf-checkout-submit",
    ]),
    node("sf-checkout-head", "Header", { title: docName, subtitle: "安全结账 · 信息加密传输" }),
    node("sf-checkout-steps", "Steps", { items: ["确认订单", "在线支付", "完成"], current: 0 }),
    node("sf-checkout-address", "Section", { title: "收货信息", description: "" }, [
      "sf-checkout-form",
    ]),
    node("sf-checkout-form", "Form", { title: "收货地址" }, [
      "sf-checkout-f-name", "sf-checkout-f-phone", "sf-checkout-f-addr",
    ]),
    node("sf-checkout-f-name", "FormField", { label: "收货人", required: true, helpText: "" }, [
      "sf-checkout-name",
    ]),
    node("sf-checkout-name", "Input", { placeholder: "请输入姓名", type: "text" }),
    node("sf-checkout-f-phone", "FormField", { label: "手机号", required: true, helpText: "用于配送通知" }, [
      "sf-checkout-phone",
    ]),
    node("sf-checkout-phone", "Input", { placeholder: "请输入 11 位手机号", type: "text" }),
    node("sf-checkout-f-addr", "FormField", { label: "详细地址", required: true, helpText: "" }, [
      "sf-checkout-addr",
    ]),
    node("sf-checkout-addr", "Textarea", { placeholder: "省 / 市 / 区 + 街道门牌", rows: 3 }),
  ];
}

/** Checkout bottom: payment method, order summary and submit. */
function checkoutBottom(): NodeRecord[] {
  return [
    node("sf-checkout-payment", "Section", { title: "支付方式", description: "" }, [
      "sf-checkout-radio",
    ]),
    node("sf-checkout-radio", "Radio", {
      items: ["在线支付（支付宝 / 微信）", "对公转账", "货到付款"],
      value: "在线支付（支付宝 / 微信）",
    }),
    node("sf-checkout-summary", "Section", { title: "订单摘要", description: "" }, [
      "sf-checkout-summary-list",
    ]),
    node("sf-checkout-summary-list", "KeyValList", {
      items: [
        { key: "商品数量", value: "4 件" },
        { key: "商品合计", value: "¥3,196" },
        { key: "运费", value: "免运费" },
        { key: "应付总额", value: "¥3,096" },
      ],
    }),
    node("sf-checkout-submit", "Stack", { gap: 2, align: "stretch" }, [
      "sf-checkout-btn", "sf-checkout-terms",
    ]),
    node("sf-checkout-btn", "Button", { label: "提交订单", variant: "primary", size: "lg" }),
    node("sf-checkout-terms", "Text", {
      content: "提交订单即表示同意《销售条款》与《退换货政策》。",
      muted: true,
    }),
  ];
}

/** Builds the three-page shopping flow: list + cart + checkout. */
export function buildShopFlow(docName: string): StudioDocument {
  return docOfPages(docName, [
    {
      id: "sf-list",
      name: "商品列表",
      rootId: "sf-list-root",
      nodes: [...listTop(docName), ...listProducts(), ...listClose()],
    },
    {
      id: "sf-cart",
      name: "购物车",
      rootId: "sf-cart-root",
      nodes: [...cartTop(docName), ...cartBottom()],
    },
    {
      id: "sf-checkout",
      name: "确认结账",
      rootId: "sf-checkout-root",
      nodes: [...checkoutTop(docName), ...checkoutBottom()],
    },
  ]);
}
