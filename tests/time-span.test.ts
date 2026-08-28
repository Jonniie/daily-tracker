import { describe, expect, it } from "vitest";
import { clampSpan, coverageMap, rangeFree } from "@/lib/time-span";

describe("coverageMap", () => {
  it("marks start cells and covered cells", () => {
    const blocks = [{ hour: 9, span: 3, id: "a" }];
    const map = coverageMap(blocks);
    expect(map.get(9)).toMatchObject({ isStart: true });
    expect(map.get(10)).toMatchObject({ isStart: false, block: blocks[0] });
    expect(map.get(11)).toMatchObject({ isStart: false });
    expect(map.get(12)).toBeUndefined();
  });

  it("first writer wins on overlapping input", () => {
    const map = coverageMap([
      { hour: 9, span: 2, id: "a" },
      { hour: 10, span: 2, id: "b" },
    ]);
    expect(map.get(10)?.block?.id).toBe("a");
  });
});

describe("clampSpan", () => {
  it("clamps to the grid end and to ≥1", () => {
    expect(clampSpan(23, 5)).toBe(1);
    expect(clampSpan(9, 0)).toBe(1);
    expect(clampSpan(9, 3)).toBe(3);
  });
});

describe("rangeFree", () => {
  const blocks = [
    { hour: 9, span: 2 }, // covers 9–10
    { hour: 14, span: 1 },
  ];

  it("accepts free ranges", () => {
    expect(rangeFree(blocks, 11, 3)).toBe(true);
    expect(rangeFree(blocks, 6, 3)).toBe(true); // 6,7,8 free
  });

  it("rejects collisions with starts and covered cells", () => {
    expect(rangeFree(blocks, 8, 2)).toBe(false); // 8–9 hits 9
    expect(rangeFree(blocks, 10, 1)).toBe(false); // covered by 9–10
    expect(rangeFree(blocks, 14, 1)).toBe(false); // exact start
  });

  it("rejects running off the grid edge", () => {
    expect(rangeFree(blocks, 23, 2)).toBe(false);
  });

  it("ignores the block being moved/resized", () => {
    expect(rangeFree(blocks, 9, 2, 9)).toBe(true); // same span, same place
    expect(rangeFree(blocks, 9, 3, 9)).toBe(true); // extend into 11 (free)
    expect(rangeFree(blocks, 9, 6, 9)).toBe(false); // would hit 14
  });
});
