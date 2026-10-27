// @vitest-environment node
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalValue, readLive } from "@/lib/ai/live";
import type { Progress } from "@/lib/copper/assistant/progress";

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => model,
}));

type Part = LanguageModelV4StreamPart;

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finish = (reason: "stop" | "tool-calls"): Part => ({
  type: "finish",
  finishReason: { unified: reason, raw: undefined },
  usage,
});

const thinks = (text: string): Part[] => [
  { type: "reasoning-start", id: "r1" },
  { type: "reasoning-delta", id: "r1", delta: text },
  { type: "reasoning-end", id: "r1" },
];
const says = (...pieces: string[]): Part[] => [
  { type: "text-start", id: "t1" },
  ...pieces.map((delta): Part => ({ type: "text-delta", id: "t1", delta })),
  { type: "text-end", id: "t1" },
  finish("stop"),
];
const calls = (toolName: string, input: unknown): Part[] => [
  { type: "tool-input-start", id: "call-1", toolName },
  { type: "tool-input-delta", id: "call-1", delta: JSON.stringify(input) },
  { type: "tool-input-end", id: "call-1" },
  {
    type: "tool-call",
    toolCallId: "call-1",
    toolName,
    input: JSON.stringify(input),
  },
  finish("tool-calls"),
];

function streaming(...steps: Part[][]) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream(steps[step++] ?? says()),
    }),
  });
}

const question = [{ role: "user" as const, content: "How much?" }];

async function loadAsk() {
  vi.resetModules();
  return import("@/lib/copper/assistant/ask");
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
});

describe("askCopper", () => {
  it("streams thinking, the tool call and the reply, each update a fresh copy", async () => {
    model = streaming(
      [
        ...thinks("I'll use **calculate_cost**."),
        ...calls("calculate_cost", {
          products: ["copper-home"],
          plan: "copper-plus",
          billing: "annual",
          years: 2,
        }),
      ],
      says("That comes ", "to $307."),
    );
    const { askCopper } = await loadAsk();
    const updates: Progress[] = [];
    for await (const update of readLive(
      (await askCopper({ messages: question, useTools: true })).progress,
    )) {
      updates.push(update);
    }

    const naming = updates.find((u) => u.steps.some((s) => s.type === "tool"))!;
    expect(naming.steps[1]).toMatchObject({
      name: "calculate_cost",
      state: "calling",
    });
    expect(naming.steps[1]).not.toHaveProperty("input");

    const last = updates.at(-1)!;
    expect(last.status).toBe("done");
    expect(last.reply).toBe("That comes to $307.");
    expect(last.steps.map((s) => s.type)).toEqual(["thinking", "tool"]);
    expect(last.steps[1]).toMatchObject({
      state: "done",
      output: expect.objectContaining({ totalUsd: 307 }),
    });
    // Earlier updates kept their own copies.
    expect(naming.steps[1]).toMatchObject({ state: "calling" });
    expect(naming).not.toBe(last);
    expect(naming.steps).not.toBe(last.steps);
  });

  it("marks a tool step as an error when its input breaks the contract", async () => {
    model = streaming(
      calls("calculate_cost", {
        products: ["copper-home"],
        plan: "copper-plus",
        billing: "annual",
        years: 9,
      }),
      says("Sorry, I can only work out 1 to 5 years."),
    );
    const { askCopper } = await loadAsk();
    const result = await finalValue(
      (await askCopper({ messages: question, useTools: true })).progress,
    );
    expect(result.steps[0]).toMatchObject({ type: "tool", state: "error" });
    expect(result.status).toBe("done");
  });

  it("apologizes when the stream ends with no reply", async () => {
    model = streaming(says());
    const { askCopper } = await loadAsk();
    const result = await finalValue(
      (await askCopper({ messages: question, useTools: true })).progress,
    );
    expect(result).toMatchObject({ status: "done" });
    expect(result.reply).toMatch(/sorry/i);
  });

  it("finishes with status error and an apology when the model fails", async () => {
    model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("model is down");
      },
    });
    const { askCopper } = await loadAsk();
    const result = await finalValue(
      (await askCopper({ messages: question, useTools: true })).progress,
    );
    expect(result.status).toBe("error");
    expect(result.reply).toMatch(/sorry/i);
  });

  it("with tools off, sends the conversation and thought summaries only", async () => {
    model = streaming(says("About $300."));
    const { askCopper } = await loadAsk();
    await finalValue(
      (await askCopper({ messages: question, useTools: false })).progress,
    );
    const call = model.doStreamCalls[0];
    expect(call.tools ?? []).toHaveLength(0);
    expect(call.prompt.some((m) => m.role === "system")).toBe(false);
    expect(call.providerOptions?.google).toHaveProperty("thinkingConfig");
  });
});
