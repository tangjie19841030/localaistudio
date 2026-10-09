import { summarize, type Issue } from "@studio/schema-core";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { visualApi, type VisualRunResult } from "../api/visual";
import { useVisualStore } from "./visualStore";

vi.mock("../api/visual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/visual")>();
  return {
    ...actual,
    visualApi: {
      runCheck: vi.fn(),
      listRuns: vi.fn(),
      shotUrl: actual.visualApi.shotUrl,
      fetchShotDataUrl: vi.fn(),
    },
  };
});

const mockedRun = vi.mocked(visualApi.runCheck);
const mockedList = vi.mocked(visualApi.listRuns);

const PID = "00000000-0000-4000-8000-000000000000";

const ISSUES: Issue[] = [
  {
    kind: "horizontal-overflow",
    viewport: "mobile",
    severity: "error",
    message: "页面在 mobile 视口出现横向滚动",
  },
  {
    kind: "text-truncation",
    viewport: "mobile",
    severity: "warn",
    message: "文本被截断",
    selector: "div.card > p",
  },
];

function makeRun(runId: string, createdAt = "2026-09-09T00:00:00.000Z"): VisualRunResult {
  return {
    runId,
    createdAt,
    url: "http://127.0.0.1:5180",
    issues: ISSUES,
    summary: summarize(ISSUES),
    shots: [
      { viewport: "desktop", file: "desktop.png" },
      { viewport: "tablet", file: "tablet.png" },
      { viewport: "mobile", file: "mobile.png" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useVisualStore.getState().clear();
  mockedList.mockResolvedValue([]);
});

describe("visualStore.run", () => {
  it("成功：running → idle，currentRun 落库且 prepend 进 runs", async () => {
    const run = makeRun("run-1");
    let seenDuringCall: string | null = null;
    mockedRun.mockImplementation(async () => {
      seenDuringCall = useVisualStore.getState().runState;
      return run;
    });

    expect(useVisualStore.getState().runState).toBe("idle");
    await useVisualStore.getState().run(PID);

    expect(seenDuringCall).toBe("running"); // 调用期间处于 running
    expect(mockedRun).toHaveBeenCalledWith(PID);
    const s = useVisualStore.getState();
    expect(s.runState).toBe("idle");
    expect(s.currentRun).toEqual(run);
    expect(s.runs).toEqual([run]);
    expect(s.error).toBeNull();
  });

  it("再次执行：新 run 排在历史最前", async () => {
    const older = makeRun("run-1", "2026-09-08T00:00:00.000Z");
    useVisualStore.setState({ runs: [older], currentRun: older });
    const newer = makeRun("run-2", "2026-09-09T10:00:00.000Z");
    mockedRun.mockResolvedValue(newer);

    await useVisualStore.getState().run(PID);
    const s = useVisualStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual(["run-2", "run-1"]);
    expect(s.currentRun?.runId).toBe("run-2");
  });

  it("失败：runState=error 且 error 文案可见", async () => {
    mockedRun.mockRejectedValue(new Error("截图执行失败"));
    await useVisualStore.getState().run(PID);
    const s = useVisualStore.getState();
    expect(s.runState).toBe("error");
    expect(s.error).toContain("截图执行失败");
    expect(s.currentRun).toBeNull();
  });

  it("409 not_generated：提示先生成代码后运行本地质检", async () => {
    mockedRun.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: "not_generated", message: "项目尚未生成代码" })),
    );
    await useVisualStore.getState().run(PID);
    const s = useVisualStore.getState();
    expect(s.runState).toBe("error");
    expect(s.error).toBe("请先生成代码再执行本地质检");
  });

  it("409 preview_not_running：提示先启动本地项目预览", async () => {
    mockedRun.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: "preview_not_running", message: "preview_not_running" })),
    );
    await useVisualStore.getState().run(PID);
    const state = useVisualStore.getState();
    expect(state.error).toBe("请先启动本地项目预览，再运行本地质检");
    expect(state.error).not.toContain("preview_not_running");
  });

  it("其它 409 保留服务端原文，不误报为未生成", async () => {
    mockedRun.mockRejectedValue(new ApiError(409, JSON.stringify({ error: "preview_busy" })));
    await useVisualStore.getState().run(PID);
    expect(useVisualStore.getState().error).toContain("preview_busy");
  });

  it("running 期间重复调用被忽略", async () => {
    useVisualStore.setState({ runState: "running" });
    await useVisualStore.getState().run(PID);
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("visualStore.loadRuns", () => {
  it("加载历史：runs 填充且最新一条成为 currentRun", async () => {
    const runs = [makeRun("run-2", "2026-09-09T00:00:00.000Z"), makeRun("run-1", "2026-09-08T00:00:00.000Z")];
    mockedList.mockResolvedValue(runs);

    await useVisualStore.getState().loadRuns(PID);
    const s = useVisualStore.getState();
    expect(mockedList).toHaveBeenCalledWith(PID);
    expect(s.runs).toEqual(runs);
    expect(s.currentRun?.runId).toBe("run-2");
  });

  it("加载失败：不进入 error 态（历史缺失不阻断操作）", async () => {
    mockedList.mockRejectedValue(new Error("boom"));
    await useVisualStore.getState().loadRuns(PID);
    const s = useVisualStore.getState();
    expect(s.runState).toBe("idle");
    expect(s.error).toBeNull();
  });
});

describe("visualStore 视口与清空", () => {
  it("selectViewport 更新选中视口，默认 desktop", () => {
    expect(useVisualStore.getState().selectedViewport).toBe("desktop");
    useVisualStore.getState().selectViewport("mobile");
    expect(useVisualStore.getState().selectedViewport).toBe("mobile");
  });

  it("clear() 复位所有字段", async () => {
    mockedRun.mockResolvedValue(makeRun("run-1"));
    await useVisualStore.getState().run(PID);
    useVisualStore.getState().selectViewport("tablet");
    useVisualStore.setState({ error: "旧错误" });

    useVisualStore.getState().clear();
    const s = useVisualStore.getState();
    expect(s.runState).toBe("idle");
    expect(s.currentRun).toBeNull();
    expect(s.runs).toEqual([]);
    expect(s.selectedViewport).toBe("desktop");
    expect(s.error).toBeNull();
  });
});

// The real module (not the mock above): shotUrl/fetchShotDataUrl are consumed by
// the P4-4 multimodal repair payload, so their output shape is pinned here.
describe("visualApi 截图地址与 data URL", () => {
  // Unconditional teardown: an inline unstub would leak the fetch stub to later
  // tests in this file whenever an assertion throws first.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function realApi() {
    const actual = await vi.importActual<typeof import("../api/visual")>("../api/visual");
    return actual.visualApi;
  }

  it("shotUrl 拼出受控的截图路径", async () => {
    const api = await realApi();
    expect(api.shotUrl(PID, "run-1", "desktop.png")).toBe(
      `/api/projects/${PID}/screenshots/run-1/desktop.png`,
    );
  });

  it("fetchShotDataUrl 把 PNG 读成 data:image/png;base64 前缀的字符串", async () => {
    const api = await realApi();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob([png], { type: "image/png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataUrl = await api.fetchShotDataUrl(PID, "run-1", "mobile.png");
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PID}/screenshots/run-1/mobile.png`);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("fetchShotDataUrl 非 2xx 抛 ApiError 带状态码", async () => {
    const api = await realApi();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" }),
    );
    await expect(api.fetchShotDataUrl(PID, "run-1", "mobile.png")).rejects.toBeInstanceOf(ApiError);
  });
});
