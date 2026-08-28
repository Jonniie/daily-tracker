import { ChartBar } from "lucide-react";
import type { WeekCoverage } from "@/lib/goal-coverage";

function hours(min: number): string {
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/**
 * "This week" goal budget: planned vs done hours per root goal, plus the
 * unallocated (goal-less) remainder. Server-rendered — no interactions.
 */
export function GoalCoveragePanel({ coverage }: { coverage: WeekCoverage }) {
  return (
    <section
      className="g-enter rounded-block bg-surface p-3 shadow-block"
      style={{ "--stagger": "40ms" } as React.CSSProperties}
    >
      <header className="mb-2 flex items-center gap-2 px-1">
        <ChartBar size={14} className="text-text-secondary" />
        <h2 className="font-display text-xs font-bold tracking-wide text-text-secondary uppercase">
          This week
        </h2>
      </header>

      {coverage.byRoot.length === 0 && coverage.unallocatedPlannedMin === 0 ? (
        <p className="px-1 text-sm text-text-secondary">
          Nothing planned this week yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {coverage.byRoot.map((root) => {
            const pct = Math.min(100, Math.round((root.doneMin / root.plannedMin) * 100));
            return (
              <li key={root.rootId}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-text-primary">
                    {root.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-secondary tabular-nums">
                    {hours(root.doneMin)}/{hours(root.plannedMin)} done
                  </span>
                </div>
                <div
                  className="h-3 border-2 border-border bg-surface-recessed"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label={`${root.title}: ${pct}% of planned hours done`}
                >
                  <div className="h-full bg-success" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
          {coverage.unallocatedPlannedMin > 0 && (
            <li className="pt-0.5 text-[11px] text-text-secondary tabular-nums">
              + {hours(coverage.unallocatedPlannedMin)} unallocated
              {coverage.unallocatedDoneMin > 0 &&
                ` (${hours(coverage.unallocatedDoneMin)} done)`}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
