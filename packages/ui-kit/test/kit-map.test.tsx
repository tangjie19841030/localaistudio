import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import {
  AppShell,
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  EmptyState,
  Form,
  FormField,
  Grid,
  Heading,
  Header,
  Image,
  Input,
  kitComponents,
  MetricGrid,
  Nav,
  Section,
  Select,
  Stack,
  StatCard,
  Table,
  Text,
  Textarea,
  Tabs,
  Breadcrumb,
  Pagination,
  Steps,
  BottomNav,
  Divider,
  Accordion,
  Switch,
  Radio,
  SearchInput,
  Slider,
  InputNumber,
  DatePicker,
  Upload,
  Avatar,
  AvatarGroup,
  List,
  KeyValList,
  Timeline,
  CodeBlock,
  Calendar,
  BarChart,
  LineChart,
  DonutChart,
  Sparkline,
  Alert,
  Progress,
  ProgressRing,
  Skeleton,
  Toast,
  Tooltip,
  Hero,
  FeatureGrid,
  PricingCard,
  Testimonial,
  StatsBanner,
  Footer,
} from "../src/index";

const expectedTypes = [
  "AppShell",
  "Header",
  "Nav",
  "Section",
  "Grid",
  "Stack",
  "Container",
  "Card",
  "MetricGrid",
  "StatCard",
  "Table",
  "Form",
  "FormField",
  "Input",
  "Select",
  "Checkbox",
  "Textarea",
  "Button",
  "Badge",
  "Heading",
  "Text",
  "Image",
  "EmptyState",
  "Tabs",
  "Breadcrumb",
  "Pagination",
  "Steps",
  "BottomNav",
  "Divider",
  "Accordion",
  "Switch",
  "Radio",
  "SearchInput",
  "Slider",
  "InputNumber",
  "DatePicker",
  "Upload",
  "Avatar",
  "AvatarGroup",
  "List",
  "KeyValList",
  "Timeline",
  "CodeBlock",
  "Calendar",
  "BarChart",
  "LineChart",
  "DonutChart",
  "Sparkline",
  "Alert",
  "Progress",
  "ProgressRing",
  "Skeleton",
  "Toast",
  "Tooltip",
  "Hero",
  "FeatureGrid",
  "PricingCard",
  "Testimonial",
  "StatsBanner",
  "Footer",
] as const;

describe("kit 组件映射表", () => {
  it("58 个 type 全部注册到 kitComponents", () => {
    expect(Object.keys(kitComponents).sort()).toEqual([...expectedTypes].sort());
  });

  it("每个映射都是可渲染的 React 组件", () => {
    for (const type of expectedTypes) {
      const comp = kitComponents[type];
      expect(typeof comp).toBe("function");
    }
  });

  it("映射表与命名导出一致（抽样）", () => {
    expect(kitComponents["Button"]).toBe(Button);
    expect(kitComponents["AppShell"]).toBe(AppShell);
    expect(kitComponents["EmptyState"]).toBe(EmptyState);
  });

  it("kitComponents 可渲染 Button", () => {
    const Btn = kitComponents["Button"] as ComponentType<{ label: string }>;
    render(<Btn label="映射表渲染" />);
    expect(screen.getByRole("button", { name: "映射表渲染" })).toBeInTheDocument();
  });

  it("data-component 与映射表键一致（抽样 StatCard）", () => {
    render(<StatCard label="L" value="1" delta="+1%" tone="brand" />);
    const box = screen.getByText("L").closest("[data-component]") as HTMLElement;
    expect(box.dataset.component).toBe("StatCard");
    expect(kitComponents["StatCard"]).toBe(StatCard);
  });
});
