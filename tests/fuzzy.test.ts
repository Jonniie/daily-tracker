import { describe, expect, it } from "vitest";
import { fuzzyScore, rankSearch } from "@/lib/goals/fuzzy";

describe("fuzzyScore", () => {
  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "ocpp work")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(fuzzyScore("OCPP", "ocpp work")).not.toBeNull();
  });

  it("scores 0 on an empty query", () => {
    expect(fuzzyScore("  ", "anything")).toBe(0);
  });

  it("rewards word-start matches over mid-word matches", () => {
    const wordStart = fuzzyScore("work", "ocpp work")!;
    const midWord = fuzzyScore("ork", "ocpp work")!;
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it("rewards consecutive runs over scattered mid-word matches", () => {
    const consecutive = fuzzyScore("tick", "weekly ticket")!;
    const scattered = fuzzyScore("tick", "therapy is cool, kid")!;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it("treats breadcrumb separators as segment starts", () => {
    const score = fuzzyScore("weekly", "work > ocpp work — weekly ticket");
    expect(score).not.toBeNull();
  });
});

describe("rankSearch", () => {
  const entries = [
    { item: "a", label: "work > ocpp work — weekly ticket" },
    { item: "b", label: "dsa > graphs — weekly contest" },
    { item: "c", label: "personal — gym" },
  ];

  it("ranks the tighter match first", () => {
    const hits = rankSearch("week", entries);
    expect(hits).toHaveLength(2);
    expect(hits).toContain("a");
    expect(hits).toContain("b");
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      item: i,
      label: `goal number ${i}`,
    }));
    expect(rankSearch("goal", many, 8)).toHaveLength(8);
  });

  it("returns everything (sorted) on an empty query", () => {
    expect(rankSearch("", entries)).toHaveLength(3);
  });
});
