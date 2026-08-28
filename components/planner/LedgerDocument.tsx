"use client";

import { Clipboard } from "lucide-react";
import { toast } from "sonner";
import type { DailyPlannerDTO } from "@/lib/planner";
import { dayMarkdown, formatClock, timeRangeLabel } from "@/lib/ledger";
import { useGoalTreeState } from "@/components/providers/GoalTreeProvider";
import { GoalChip } from "./GoalChip";
import { GoalHoverCard } from "./GoalHoverCard";

const KIND_DOT: Record<string, string> = {
  did: "bg-success",
  "goal-completed": "bg-success",
  planned: "bg-primary",
  extra: "bg-primary",
  carried: "bg-text-secondary/50",
  removed: "bg-text-secondary/50",
  undid: "bg-text-secondary/50",
};

/**
 * One day rendered as a printed log page: time blocks (with done marks and
 * goal tags), backlog, and the auto-written ledger. "Copy as markdown"
 * exports the same document in the user's daily-note format.
 */
export function LedgerDocument({ planner }: { planner: DailyPlannerDTO }) {
  const { byId } = useGoalTreeState();

  const copy = () => {
    const md = dayMarkdown({
      date: planner.date,
      blocks: planner.timeBlocks,
      backlog: planner.backlog,
      ledger: planner.ledger,
      goalTitle: (id) => byId.get(id)?.title ?? "goal",
    });
    navigator.clipboard
      .writeText(md)
      .then(() => toast.success("Copied as markdown"))
      .catch(() => toast.error("Copy failed — clipboard unavailable"));
  };

  const blocks = [...planner.timeBlocks].sort((a, b) => a.hour - b.hour);
  const isEmpty =
    blocks.length === 0 && planner.backlog.length === 0 && planner.ledger.length === 0;

  return (
    <article
      className="g-enter rounded-block bg-surface p-5 shadow-block sm:p-6"
      style={{ "--stagger": "60ms" } as React.CSSProperties}
    >
      <div className="flex items-center justify-between border-b-2 border-border pb-3">
        <span className="text-xs font-bold tracking-[0.2em] text-text-secondary uppercase">
          Field log
        </span>
        <button
          type="button"
          onClick={copy}
          className="g-btn inline-flex items-center gap-1.5 rounded-chip border-2 border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Clipboard size={12} strokeWidth={2.5} />
          Copy as markdown
        </button>
      </div>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-text-secondary">
          Nothing recorded for this day. Plan blocks in Today, finish them, and the
          record writes itself here.
        </p>
      ) : (
        <>
          {blocks.length > 0 && (
            <section className="mt-5">
              <h2 className="mb-2 text-[11px] font-bold tracking-[0.15em] text-text-secondary uppercase">
                Time blocks
              </h2>
              <ul>
                {blocks.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center gap-3 border-b border-border/40 py-2 last:border-b-0"
                  >
                    <span className="w-28 shrink-0 text-xs font-semibold text-text-secondary tabular-nums">
                      {timeRangeLabel(b.hour, b.span)}
                    </span>
                    <span
                      className={`text-sm font-medium ${
                        b.done ? "text-text-secondary line-through" : "text-text-primary"
                      }`}
                    >
                      {b.task || "Goal block"}
                    </span>
                    {b.done && (
                      <span className="shrink-0 rounded-chip bg-success px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                        Done
                      </span>
                    )}
                    {b.goalIds.length > 0 && (
                      <span className="ml-auto flex shrink-0 flex-wrap gap-1">
                        {b.goalIds.map((id) => (
                          <GoalChip key={id} goalId={id} />
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {planner.backlog.length > 0 && (
            <section className="mt-5">
              <h2 className="mb-2 text-[11px] font-bold tracking-[0.15em] text-text-secondary uppercase">
                Extras
              </h2>
              <ul>
                {planner.backlog.map((item) => (
                  <li
                    key={item.id}
                    className="border-b border-border/40 py-1.5 text-sm text-text-primary last:border-b-0"
                  >
                    <GoalHoverCard goalId={item.goalId}>
                      <span>{byId.get(item.goalId)?.title ?? "goal"}</span>
                    </GoalHoverCard>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {planner.ledger.length > 0 && (
            <section className="mt-5">
              <h2 className="mb-2 text-[11px] font-bold tracking-[0.15em] text-text-secondary uppercase">
                Ledger
              </h2>
              <ul>
                {[...planner.ledger]
                  .sort((a, b) => a.at.localeCompare(b.at))
                  .map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-baseline gap-3 border-b border-border/40 py-1.5 last:border-b-0"
                    >
                      <span className="w-10 shrink-0 text-[11px] font-medium text-text-secondary tabular-nums">
                        {formatClock(entry.at)}
                      </span>
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 self-center rounded-none ${
                          KIND_DOT[entry.kind] ?? "bg-text-secondary/50"
                        }`}
                      />
                      <span className="text-sm text-text-primary">{entry.text}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}
