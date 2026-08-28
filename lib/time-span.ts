/**
 * Span math for multi-hour time blocks — pure, client-safe (no Prisma).
 * A block owns [hour, hour + span); cells inside that range are "covered".
 */

export interface SpanLike {
  hour: number;
  span: number;
}

/** Grid bounds: 6 AM through 11 PM (last cell starts 23:00, day ends 24:00). */
export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 24;

export interface CellCoverage<T extends SpanLike> {
  /** The block starting in or covering this hour, if any. */
  block: T | null;
  /** True when this hour is the block's own start cell. */
  isStart: boolean;
}

/**
 * Map every hour in the grid to its coverage. Blocks are clamped to the grid
 * and overlapping input is resolved first-writer-wins (server validates, so
 * this is just defensive).
 */
export function coverageMap<T extends SpanLike>(
  blocks: T[],
): Map<number, CellCoverage<T>> {
  const map = new Map<number, CellCoverage<T>>();
  for (const block of blocks) {
    const span = clampSpan(block.hour, block.span);
    for (let h = block.hour; h < block.hour + span; h++) {
      if (h < GRID_START_HOUR || h >= GRID_END_HOUR) continue;
      if (map.has(h)) continue;
      map.set(h, { block, isStart: h === block.hour });
    }
  }
  return map;
}

/** Clamp a span to the grid: ≥1, never past midnight. */
export function clampSpan(hour: number, span: number): number {
  return Math.max(1, Math.min(span, GRID_END_HOUR - hour));
}

/**
 * True when [hour, hour+span) collides with no existing block.
 * `ignoreHour` excludes the block starting at that hour (moving/resizing itself).
 */
export function rangeFree(
  blocks: SpanLike[],
  hour: number,
  span: number,
  ignoreHour?: number,
): boolean {
  const coverage = coverageMap(blocks.filter((b) => b.hour !== ignoreHour));
  const clamped = clampSpan(hour, span);
  if (clamped !== span) return false; // ran off the grid edge
  for (let h = hour; h < hour + span; h++) {
    if (coverage.has(h)) return false;
  }
  return true;
}
