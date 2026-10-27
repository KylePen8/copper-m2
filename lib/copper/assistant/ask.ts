"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress, ToolStep } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const NO_REPLY = "Sorry, I couldn't come up with an answer. Please try again.";
const FAILED = "Sorry, something went wrong on my end. Please try again.";

/** A copy the panel can keep: the steps array and each step are new objects. */
function snapshot(progress: Progress): Progress {
  return { ...progress, steps: progress.steps.map((step) => ({ ...step })) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const { messages, useTools } = request;
  const live = createLive<Progress>();
  const progress: Progress = { steps: [], reply: "", status: "working" };

  const findTool = (id: string) =>
    progress.steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  async function pump() {
    try {
      // With tools off, the model gets only the conversation: no instructions
      // telling it to check, and nothing to check with.
      const result = callStream(
        { module: 2, feature: "ask-copper" },
        {
          messages,
          providerOptions: THOUGHT_SUMMARIES,
          ...(useTools && {
            instructions: COPPER_INSTRUCTIONS,
            tools: copperTools,
            stopWhen: stepCountIs(MAX_STEPS),
          }),
        },
      );

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "reasoning-delta": {
            const last = progress.steps.at(-1);
            if (last?.type === "thinking") last.text += part.text;
            else progress.steps.push({ type: "thinking", text: part.text });
            break;
          }
          case "tool-input-start":
            // The name arrives before the input, so the panel can show the
            // tool while the model is still filling in the details.
            progress.steps.push({
              type: "tool",
              id: part.id,
              name: part.toolName,
              state: "calling",
            });
            break;
          case "tool-call": {
            const step = findTool(part.toolCallId);
            if (step) step.input = part.input;
            break;
          }
          case "tool-result": {
            const step = findTool(part.toolCallId);
            if (step) {
              step.output = part.output;
              step.state = "done";
            }
            break;
          }
          case "tool-error": {
            const step = findTool(part.toolCallId);
            if (step) {
              step.output = errorMessage(part.error);
              step.state = "error";
            }
            break;
          }
          case "text-delta":
            progress.reply += part.text;
            break;
          case "error":
            throw part.error;
          default:
            continue;
        }
        live.update(snapshot(progress));
      }

      if (!progress.reply) progress.reply = NO_REPLY;
      progress.status = "done";
    } catch {
      if (!progress.reply) progress.reply = FAILED;
      progress.status = "error";
    }
    live.done(snapshot(progress));
  }

  // Return straight away and read the stream in the background.
  void pump();
  return { progress: live.live };
}
