import { hourLabel } from "./date-key";
import type { BacklogItemDTO, LedgerEntryDTO, TimeBlockDTO } from "./planner";

/** Ledger line kinds — drive the accent/icon in the UI. */
export type LedgerKind =
  | "planned"
  | "did"
  | "undid"
  | "carried"
  | "goal-completed"
  | "removed"
  | "extra";

/* --------------------------- line formatters --------------------------- */

export function timeRangeLabel(hour: number, span: number): string {
  return `${hourLabel(hour)}–${hourLabel(hour + span)}`;
}

export function ledgerPlanned(task: string, hour: number, span: number): string {
  return `Planned “${task}” at ${hourLabel(hour)}${span > 1 ? ` (${span}h)` : ""}`;
}

export function ledgerDid(task: string, hour: number, span: number): string {
  return `Did “${task}” (${timeRangeLabel(hour, span)})`;
}

export function ledgerUndid(task: string, hour: number, span: number): string {
  return `Back to planned: “${task}” (${timeRangeLabel(hour, span)})`;
}

export function ledgerCarried(count: number, fromDateLabel: string): string {
  return `Carried ${count} item${count === 1 ? "" : "s"} from ${fromDateLabel}`;
}

export function ledgerGoalCompleted(title: string): string {
  return `Completed goal “${title}”`;
}

export function ledgerRemoved(task: string, hour: number): string {
  return `Removed “${task}” (${hourLabel(hour)})`;
}

export function ledgerExtra(title: string): string {
  return `Added extra “${title}”`;
}

/* ------------------------- markdown day export ------------------------- */

/**
 * Render a day as markdown in the user's daily-note style (plain bulleted
 * sections). Used by the "Copy as markdown" button — no file writes.
 */
export function dayMarkdown(input: {
  date: string;
  blocks: TimeBlockDTO[];
  backlog: BacklogItemDTO[];
  ledger: LedgerEntryDTO[];
  goalTitle: (id: string) => string;
}): string {
  const { date, blocks, backlog, ledger, goalTitle } = input;
  const lines: string[] = [`# ${date}`, ""];

  if (blocks.length > 0) {
    lines.push("## Time blocks");
    for (const b of [...blocks].sort((a, x) => a.hour - x.hour)) {
      const done = b.done ? " (done)" : "";
      const goals = b.goalIds.map((id) => `#${goalTitle(id)}`).join(" ");
      lines.push(`- ${timeRangeLabel(b.hour, b.span)} — ${b.task}${done}${goals ? ` ${goals}` : ""}`);
    }
    lines.push("");
  }

  if (backlog.length > 0) {
    lines.push("## Extras");
    for (const item of backlog) lines.push(`- ${goalTitle(item.goalId)}`);
    lines.push("");
  }

  if (ledger.length > 0) {
    lines.push("## Ledger");
    for (const e of [...ledger].sort((a, b) => a.at.localeCompare(b.at))) {
      lines.push(`- ${formatClock(e.at)} ${e.text}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** "09:05" from an ISO timestamp (local). */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
