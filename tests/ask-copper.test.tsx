import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AskCopper, STARTER_QUESTIONS } from "@/components/copper/ask-copper";
import { createLive } from "@/lib/ai/live";
import type { Progress, Step } from "@/lib/copper/assistant/progress";

const askCopper = vi.fn();
vi.mock("@/lib/copper/assistant/ask", () => ({
  askCopper: (...args: unknown[]) => askCopper(...args),
}));

function answered(reply: string, steps: Step[] = []) {
  const live = createLive<Progress>();
  live.done({ steps, reply, status: "done" });
  return { progress: live.live };
}

const tool = (name: string, input: unknown, output: unknown): Step => ({
  type: "tool",
  id: "call-1",
  name,
  state: "done",
  input,
  output,
});

async function openChat() {
  fireEvent.click(screen.getByTestId("ask-copper-launcher"));
  return within(await screen.findByTestId("ask-copper"));
}

async function ask(chat: ReturnType<typeof within>, question: string) {
  fireEvent.change(chat.getByRole("textbox"), { target: { value: question } });
  fireEvent.click(chat.getByRole("button", { name: /send/i }));
}

beforeEach(() => {
  askCopper.mockReset();
  window.history.replaceState(null, "", "/");
});

describe("AskCopper", () => {
  it("hides the starter questions while an answer streams, then brings them back", async () => {
    const live = createLive<Progress>();
    askCopper.mockResolvedValue({ progress: live.live });
    render(<AskCopper aiConfigured />);
    const chat = await openChat();

    fireEvent.click(chat.getByRole("button", { name: STARTER_QUESTIONS[2] }));
    live.update({ steps: [], reply: "Yearly", status: "working" });
    await waitFor(() => expect(chat.getByText("Yearly")).toBeInTheDocument());
    expect(
      chat.queryByRole("button", { name: STARTER_QUESTIONS[0] }),
    ).toBeNull();
    expect(chat.getByRole("button", { name: /send/i })).toBeDisabled();

    live.done({ steps: [], reply: "Yearly is cheaper.", status: "done" });
    await waitFor(() =>
      expect(chat.getByText("Yearly is cheaper.")).toBeInTheDocument(),
    );
    for (const question of STARTER_QUESTIONS) {
      expect(chat.getByRole("button", { name: question })).toBeInTheDocument();
    }
  });

  it("opens from an #ask link every time it's clicked", async () => {
    render(
      <>
        <a href="#ask">Ask Copper link</a>
        <AskCopper aiConfigured />
      </>,
    );
    const link = screen.getByText("Ask Copper link");
    fireEvent.click(link);
    expect(await screen.findByTestId("ask-copper")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("ask-copper")).toBeNull());
    fireEvent.click(link);
    expect(await screen.findByTestId("ask-copper")).toBeInTheDocument();
  });

  it("shows stock as pills, with the restock date for back-ordered colors", async () => {
    askCopper.mockResolvedValue(
      answered("Night Sky is back-ordered.", [
        tool(
          "check_availability",
          { product: "copper-notes", color: "Night Sky" },
          {
            status: "ok",
            product: "Copper Notes",
            colors: [
              {
                color: "Night Sky",
                stock: "backordered",
                restockDate: "2026-11-14",
              },
            ],
          },
        ),
      ]),
    );
    render(<AskCopper aiConfigured />);
    const chat = await openChat();
    await ask(chat, "Is Copper Notes in Night Sky in stock?");

    const card = within(await chat.findByTestId("tool-call"));
    expect(card.getByText("Copper Notes")).toBeInTheDocument();
    expect(
      card.getByText("Back-ordered until Nov 14, 2026"),
    ).toBeInTheDocument();
  });

  it('names the real colors for "not_a_color"', async () => {
    askCopper.mockResolvedValue(
      answered("Copper Notes doesn't come in Patina Teal.", [
        tool(
          "check_availability",
          { product: "copper-notes", color: "Patina Teal" },
          {
            status: "not_a_color",
            product: "Copper Notes",
            color: "Patina Teal",
            colors: ["Brushed Copper", "Desert Sand", "Night Sky"],
          },
        ),
      ]),
    );
    render(<AskCopper aiConfigured />);
    const chat = await openChat();
    await ask(chat, "Copper Notes in Patina Teal?");

    const card = await chat.findByTestId("tool-call");
    expect(card.textContent).toMatch(
      /doesn.t come in Patina Teal\. It comes in Brushed Copper, Desert Sand, Night Sky/,
    );
  });

  it("labels the tools-off chat as having no tools", async () => {
    askCopper.mockResolvedValue(answered("About $300."));
    render(<AskCopper aiConfigured />);
    const chat = await openChat();
    fireEvent.click(chat.getByRole("switch", { name: /use tools/i }));
    expect(chat.getByText("Model guesses alone")).toBeInTheDocument();
    await ask(chat, "How much?");

    await waitFor(() =>
      expect(chat.getByText("About $300.")).toBeInTheDocument(),
    );
    expect(chat.getByText(/tools given to copper: none/i)).toBeInTheDocument();
    expect(chat.getByText(/answered without tools/i)).toBeInTheDocument();
    expect(askCopper).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "How much?" }],
      useTools: false,
    });
  });
});
