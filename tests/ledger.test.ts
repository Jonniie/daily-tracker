import { describe, expect, it } from "vitest";
import {
  dayMarkdown,
  formatClock,
  ledgerCarried,
  ledgerDid,
  ledgerGoalCompleted,
  ledgerPlanned,
  ledgerRemoved,
  ledgerUndid,
  timeRangeLabel,
} from "@/lib/ledger";

describe("ledger line formatters", () => {
  it("formats planned with span note only when >1h", () => {
    expect(ledgerPlanned("deep work", 9, 1)).toBe("Planned “deep work” at 9 AM");
    expect(ledgerPlanned("deep work", 9, 3)).toBe("Planned “deep work” at 9 AM (3h)");
  });

  it("formats did/undid with the time range", () => {
    expect(ledgerDid("deep work", 9, 3)).toBe("Did “deep work” (9 AM–12 PM)");
    expect(ledgerUndid("deep work", 9, 3)).toBe("Back to planned: “deep work” (9 AM–12 PM)");
  });

  it("formats carried with pluralization", () => {
    expect(ledgerCarried(1, "Aug 26")).toBe("Carried 1 item from Aug 26");
    expect(ledgerCarried(3, "Aug 26")).toBe("Carried 3 items from Aug 26");
  });

  it("formats goal completion and removal", () => {
    expect(ledgerGoalCompleted("ocpp work")).toBe("Completed goal “ocpp work”");
    expect(ledgerRemoved("deep work", 14)).toBe("Removed “deep work” (2 PM)");
  });

  it("timeRangeLabel crosses AM/PM correctly", () => {
    expect(timeRangeLabel(11, 3)).toBe("11 AM–2 PM");
  });
});

describe("dayMarkdown", () => {
  it("renders vault-style sections in chronological order", () => {
    const md = dayMarkdown({
      date: "2026-08-27",
      blocks: [
        { id: "b2", hour: 14, span: 1, task: "review", done: false, goalIds: [] },
        { id: "b1", hour: 9, span: 3, task: "deep work", done: true, goalIds: ["g1"] },
      ],
      backlog: [{ id: "i1", goalId: "g2", note: null }],
      ledger: [
        { id: "e2", kind: "did", text: "Did “deep work” (9 AM–12 PM)", at: "2026-08-27T12:05:00" },
        { id: "e1", kind: "planned", text: "Planned “deep work” at 9 AM (3h)", at: "2026-08-27T08:30:00" },
      ],
      goalTitle: (id) => (id === "g1" ? "daily-tracker" : "gym"),
    });
    expect(md).toContain("# 2026-08-27");
    expect(md).toContain("## Time blocks");
    expect(md).toContain("- 9 AM–12 PM — deep work (done) #daily-tracker");
    expect(md).toContain("- 2 PM–3 PM — review");
    expect(md).toContain("## Extras");
    expect(md).toContain("- gym");
    expect(md.indexOf("08:30 Planned")).toBeLessThan(md.indexOf("12:05 Did"));
  });

  it("omits empty sections", () => {
    const md = dayMarkdown({
      date: "2026-08-27",
      blocks: [],
      backlog: [],
      ledger: [],
      goalTitle: () => "?",
    });
    expect(md).toBe("# 2026-08-27\n");
  });

  it("formatClock zero-pads and renders in APP_TZ (Africa/Lagos, UTC+1)", () => {
    // Real inputs are UTC instants (Prisma createdAt serialised with Z).
    expect(formatClock("2026-08-27T08:05:00Z")).toBe("09:05");
  });
});
