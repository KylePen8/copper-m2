"use client";

// Module 2: Ask Copper, the floating chat panel. It sends each question to the
// askCopper Server Action and draws the answer as it streams in: the tools on
// offer, Copper's thinking, each tool call (what went in, what came back) and
// the reply. Tools on and tools off are two separate conversations.
// The layout is described in specs/module-2/spec.md, sections 4 and 5.
import { format, parseISO } from "date-fns";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BrainIcon,
  MessageCircleIcon,
  ToolCaseIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import Image from "next/image";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import {
  type Progress,
  type ToolStep,
  TOOL_LABELS,
} from "@/lib/copper/assistant/progress";
import type {
  Availability,
  CostBreakdown,
  Prices,
  ProductList,
} from "@/lib/copper/assistant/tools";
import { formatUsd } from "@/lib/copper/catalog";
import { cn } from "@/lib/utils";

export const STARTER_QUESTIONS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

const FAILED = "Sorry, something went wrong on my end. Please try again.";

type Turn = { id: string; question: string; progress: Progress };
type ChatKey = "on" | "off";

/** The conversation so far as plain turns: questions and finished replies. */
function historyOf(turns: Turn[]): ChatMessage[] {
  return turns.flatMap(({ question, progress }) => [
    { role: "user" as const, content: question },
    ...(progress.reply
      ? [{ role: "assistant" as const, content: progress.reply }]
      : []),
  ]);
}

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Record<ChatKey, Turn[]>>({
    on: [],
    off: [],
  });
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const key: ChatKey = useTools ? "on" : "off";
  const turns = chats[key];
  const busy = turns.some((turn) => turn.progress.status === "working");

  // Open on /#ask, on a later change to #ask, and on any click of an #ask
  // link: once the address already ends in #ask, a click fires no hashchange.
  useEffect(() => {
    const openIfAsked = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('a[href$="#ask"]')) setOpen(true);
    };
    openIfAsked();
    window.addEventListener("hashchange", openIfAsked);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openIfAsked);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // Keep the newest step in view as the answer streams in.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [turns]);

  function setTurn(chat: ChatKey, id: string, progress: Progress) {
    setChats((prev) => ({
      ...prev,
      [chat]: prev[chat].map((turn) =>
        turn.id === id ? { ...turn, progress } : turn,
      ),
    }));
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const chat = key;
    const id = nanoid();
    const messages = [
      ...historyOf(chats[chat]),
      { role: "user" as const, content: text },
    ];
    setDraft("");
    setChats((prev) => ({
      ...prev,
      [chat]: [
        ...prev[chat],
        {
          id,
          question: text,
          progress: { steps: [], reply: "", status: "working" },
        },
      ],
    }));
    try {
      const { progress } = await askCopper({
        messages,
        useTools: chat === "on",
      });
      for await (const update of readLive(progress)) setTurn(chat, id, update);
    } catch {
      setTurn(chat, id, { steps: [], reply: FAILED, status: "error" });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <>
      <Button
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 h-12 gap-2 rounded-full px-5 shadow-lg"
      >
        <MessageCircleIcon className="size-5" />
        Ask Copper
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-testid="ask-copper"
          side="right"
          showCloseButton={false}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <header className="bg-chart-5 text-white">
            <div className="flex items-center gap-3 p-4">
              <div className="bg-primary flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
                <Image
                  src="/assets/brand/copper-mascot.png"
                  alt="Copper the robot, the Copper State Labs mascot"
                  width={40}
                  height={40}
                />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-white">Ask Copper</SheetTitle>
                <SheetDescription className="text-white/70">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  className="text-white hover:bg-white/10 hover:text-white"
                >
                  <XIcon />
                </Button>
              </SheetClose>
            </div>
            {aiConfigured && (
              <div className="flex items-center gap-3 bg-white/5 px-4 py-2">
                <div className="flex-1">
                  <div className="text-sm font-medium">Use tools</div>
                  <div className="text-xs text-white/70">
                    {useTools ? "Checks every answer" : "Model guesses alone"}
                  </div>
                </div>
                <Switch
                  aria-label="Use tools"
                  checked={useTools}
                  onCheckedChange={setUseTools}
                />
              </div>
            )}
          </header>

          {aiConfigured ? (
            <>
              <div
                ref={bodyRef}
                className="bg-secondary flex flex-1 flex-col gap-6 overflow-y-auto p-4"
              >
                {turns.map((turn) => (
                  <div key={turn.id} className="flex flex-col gap-4">
                    <div className="bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2">
                      {turn.question}
                    </div>
                    <Answer progress={turn.progress} useTools={key === "on"} />
                  </div>
                ))}
                {!busy && (
                  <div className="flex flex-col gap-2">
                    {turns.length === 0 && (
                      <p className="text-muted-foreground text-sm">
                        Ask about prices, totals or stock. Try one of these:
                      </p>
                    )}
                    {STARTER_QUESTIONS.map((question) => (
                      <Button
                        key={question}
                        variant="outline"
                        onClick={() => void ask(question)}
                        className="h-auto justify-start rounded-xl text-left whitespace-normal"
                      >
                        {question}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <form
                onSubmit={onSubmit}
                className="bg-background flex items-end gap-2 border-t p-3"
              >
                <Textarea
                  aria-label="Your question"
                  placeholder="Ask Copper about prices or stock…"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void ask(draft);
                    }
                  }}
                  rows={1}
                  className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={busy || !draft.trim()}
                  className="size-10 shrink-0 rounded-full"
                >
                  <ArrowUpIcon />
                </Button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto p-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// One answer: the stations on the rail, then the reply.
// ---------------------------------------------------------------------------

function Answer({
  progress,
  useTools,
}: {
  progress: Progress;
  useTools: boolean;
}) {
  const { steps, reply, status } = progress;
  const working = status === "working";
  const used = new Set(
    steps.filter((s): s is ToolStep => s.type === "tool").map((s) => s.name),
  );
  const toolNumbers = new Map<string, number>();
  for (const step of steps) {
    if (step.type === "tool") toolNumbers.set(step.id, toolNumbers.size + 1);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-col gap-5 pl-9">
        <div
          aria-hidden
          className={cn(
            "absolute top-3 bottom-3 left-[11px] w-0.5 rounded-full",
            useTools
              ? "from-primary via-accent to-accent bg-gradient-to-b"
              : "bg-chart-3",
          )}
        />
        <Station
          node={<ToolCaseIcon />}
          nodeClass={useTools ? "bg-primary" : "bg-chart-3"}
          label={
            useTools ? "Tools Copper can use" : "Tools given to Copper: none"
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(TOOL_LABELS).map((name) => (
              <span
                key={name}
                className={cn(
                  "rounded-md px-2 py-0.5 font-mono text-xs",
                  !useTools && "text-muted-foreground line-through",
                  useTools && used.has(name)
                    ? "bg-accent text-accent-foreground font-bold"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {name}
              </span>
            ))}
          </div>
          {!useTools && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Copper has to answer from memory alone.
            </p>
          )}
        </Station>

        {steps.map((step, i) =>
          step.type === "thinking" ? (
            <Station
              key={`thinking-${i}`}
              node={<BrainIcon />}
              nodeClass={useTools ? "bg-primary" : "bg-chart-3"}
              label="Copper is thinking"
            >
              <div
                data-testid="thinking"
                className="text-muted-foreground border-l-2 pl-3 text-sm italic"
              >
                <MessageResponse isAnimating={working}>
                  {step.text}
                </MessageResponse>
              </div>
            </Station>
          ) : (
            <Station
              key={step.id}
              node={<WrenchIcon />}
              nodeClass="bg-accent"
              label={
                step.state === "calling"
                  ? "Copper is calling a tool"
                  : "Copper called a tool"
              }
            >
              <ToolCard step={step} number={toolNumbers.get(step.id) ?? 1} />
            </Station>
          ),
        )}

        {working && (
          <div className="relative flex min-h-6 items-center">
            <span
              aria-hidden
              className="bg-background ring-secondary absolute -left-9 flex size-6 items-center justify-center gap-0.5 rounded-full ring-4"
            >
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="bg-primary size-1 animate-bounce rounded-full"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
            <span className="text-muted-foreground text-sm">
              {reply
                ? "Writing the answer…"
                : !useTools
                  ? "Answering from memory…"
                  : steps.length
                    ? "Deciding what to do next…"
                    : "Reading your question…"}
            </span>
          </div>
        )}
      </div>

      {(reply || !working) && (
        <div className="bg-card ml-9 rounded-2xl rounded-tl-sm border p-4 shadow-sm">
          <div className="text-primary mb-1 text-xs font-semibold">Copper</div>
          {!useTools && (
            <div className="border-chart-3 bg-chart-3/10 mb-3 rounded-lg border p-3 text-sm">
              <div className="flex items-center gap-1.5 font-semibold">
                <TriangleAlertIcon className="text-chart-3 size-4" />
                Answered without tools: may be made up
              </div>
              <p className="text-muted-foreground mt-1">
                With tools off, Copper can&apos;t see today&apos;s prices or
                stock. The AI only has what it learned in training, so it fills
                the gaps with guesses that sound right. That&apos;s a
                hallucination.
              </p>
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap">
            {reply}
            {working && (
              <span
                aria-hidden
                className="bg-primary ml-0.5 inline-block h-4 w-0.5 animate-pulse align-middle"
              />
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function Station({
  node,
  nodeClass,
  label,
  children,
}: {
  node: ReactNode;
  nodeClass: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn(
          "ring-secondary absolute -left-9 flex size-6 items-center justify-center rounded-full text-white ring-4 [&_svg]:size-3.5",
          nodeClass,
        )}
      >
        {node}
      </span>
      <div className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The tool card: always open, what Copper sent above what came back.
// ---------------------------------------------------------------------------

function ToolCard({ step, number }: { step: ToolStep; number: number }) {
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card overflow-hidden rounded-xl border text-sm"
    >
      <div className="bg-accent text-accent-foreground flex items-center gap-2 px-3 py-2">
        <span className="font-mono font-bold">{step.name}()</span>
        <span className="rounded bg-white/20 px-1.5 text-[10px]">
          tool {number}
        </span>
        <span className="ml-auto text-xs">
          {TOOL_LABELS[step.name] ?? "Using a tool"}
        </span>
      </div>
      <div className="p-3">
        <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold tracking-widest uppercase">
          <ArrowRightIcon className="size-3" /> What Copper sent
        </div>
        {step.input === undefined ? (
          <p className="text-muted-foreground italic">
            filling in the details…
          </p>
        ) : (
          <SentInput name={step.name} input={step.input} />
        )}
      </div>
      <div className="bg-accent/5 border-t p-3">
        <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold tracking-widest uppercase">
          <ArrowLeftIcon className="size-3" /> What came back
        </div>
        {step.state === "calling" ? (
          <p className="text-muted-foreground flex items-center gap-2 italic">
            <Spinner className="size-3.5" /> the app is running the code…
          </p>
        ) : step.state === "error" ? (
          <p className="text-chart-3">{String(step.output)}</p>
        ) : (
          <ToolOutput name={step.name} output={step.output} />
        )}
      </div>
    </div>
  );
}

/** "copper-home" → "Copper Home". */
function titleCase(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SentInput({ name, input }: { name: string; input: unknown }) {
  const value = (input ?? {}) as Record<string, unknown>;
  if (name === "get_prices") {
    return <p>Nothing, it just asked for the price list</p>;
  }
  if (name === "get_products") {
    return <p>Nothing, it just asked what Copper sells</p>;
  }
  if (name === "calculate_cost") {
    const products = Array.isArray(value.products) ? value.products : [];
    return (
      <Rows
        rows={[
          [
            "Products",
            products.length
              ? products.map((p) => titleCase(String(p))).join(", ")
              : "None",
          ],
          ["Plan", titleCase(String(value.plan ?? ""))],
          ["Billing", String(value.billing ?? "")],
          ["Years", String(value.years ?? "")],
        ]}
      />
    );
  }
  if (name === "check_availability") {
    return (
      <Rows
        rows={[
          ["Product", titleCase(String(value.product ?? ""))],
          ["Color", value.color ? String(value.color) : "Every color"],
        ]}
      />
    );
  }
  return (
    <Rows
      rows={Object.entries(value).map(([k, v]) => [titleCase(k), String(v)])}
    />
  );
}

const STOCK_PILLS = {
  in_stock: "bg-accent text-accent-foreground",
  low_stock: "bg-chart-4 text-chart-5",
  backordered: "bg-chart-3 text-white",
};

function ToolOutput({ name, output }: { name: string; output: unknown }) {
  if (name === "calculate_cost") {
    const { lines, totalUsd } = output as CostBreakdown;
    return (
      <div>
        {lines.map((line, i) => (
          <div key={i} className="flex justify-between gap-4">
            <span>{line.item}</span>
            <span className="tabular-nums">{formatUsd(line.usd)}</span>
          </div>
        ))}
        <div className="mt-2 flex items-baseline justify-between border-t pt-2">
          <span className="font-semibold">Total</span>
          <span className="text-primary text-xl font-bold tabular-nums">
            {formatUsd(totalUsd)}
          </span>
        </div>
      </div>
    );
  }
  if (name === "get_products") {
    const { products } = output as ProductList;
    return (
      <div className="flex flex-col gap-3">
        {products.map((product) => (
          <div key={product.id}>
            <div className="flex justify-between gap-4 font-medium">
              <span>{product.name}</span>
              <span>{formatUsd(product.priceUsd)}</span>
            </div>
            <div className="text-muted-foreground text-xs">{product.type}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {product.colors.map((color) => (
                <span
                  key={color}
                  className="bg-accent/15 text-accent rounded-full px-2 py-0.5 text-xs"
                >
                  {color}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (name === "get_prices") {
    const { products, plans } = output as Prices;
    return (
      <div>
        {products.map((product) => (
          <div key={product.id} className="flex justify-between gap-4">
            <span>{product.name}</span>
            <span>{formatUsd(product.priceUsd)}</span>
          </div>
        ))}
        {plans
          .filter((plan) => plan.monthlyUsd > 0 || plan.annualUsd > 0)
          .map((plan) => (
            <div key={plan.id} className="flex justify-between gap-4">
              <span>{plan.name}</span>
              <span>
                {formatUsd(plan.monthlyUsd)}/mo · {formatUsd(plan.annualUsd)}/yr
              </span>
            </div>
          ))}
      </div>
    );
  }
  if (name === "check_availability") {
    const result = output as Availability;
    if (result.status === "unavailable") return <p>{result.message}</p>;
    if (result.status === "not_a_color") {
      return (
        <p>
          {result.product} doesn&apos;t come in {result.color}. It comes in{" "}
          {result.colors.join(", ")}.
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        {result.colors.map(({ color, stock, restockDate }) => (
          <div key={color} className="flex items-center justify-between gap-4">
            <span>{color}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                STOCK_PILLS[stock],
              )}
            >
              {stock === "in_stock"
                ? "In stock"
                : stock === "low_stock"
                  ? "Low stock"
                  : `Back-ordered until ${restockDate ? format(parseISO(restockDate), "MMM d, yyyy") : "later"}`}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <pre className="text-xs whitespace-pre-wrap">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}
