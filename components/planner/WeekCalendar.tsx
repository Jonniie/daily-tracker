"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Check, LayoutGrid, Minus, Plus, Trash2 } from "lucide-react";
import type { DayPlannerDTO, TimeBlockDTO, WeekPlannerDTO } from "@/lib/planner";
import { dayFullLabel, hourLabel, isValidDateKey } from "@/lib/date-key";
import { coverageMap, rangeFree, GRID_START_HOUR, GRID_END_HOUR } from "@/lib/time-span";
import {
  addBlockLocal,
  moveBlockLocal,
  patchBlockLocal,
  removeBlockLocal,
  resizeBlockLocal,
  type CellRef,
} from "@/lib/planner-ops";
import {
  AnchoredPopover,
  measureAnchor,
  type AnchorRect,
} from "@/components/ui/AnchoredPopover";
import { useGoalTreeState } from "@/components/providers/GoalTreeProvider";
import {
  deleteTimeBlock,
  moveTimeBlock,
  planBacklogItem,
  setTimeBlockSpan,
  toggleTimeBlockDone,
  unlinkGoalFromTimeBlock,
} from "@/app/actions/planner";
import { GoalMentionInput } from "./GoalMentionInput";
import { GoalChip } from "./GoalChip";
import { GoalHoverCard } from "./GoalHoverCard";

/** Displayed hours: 6 AM – 11 PM. */
const HOURS = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR },
  (_, i) => i + GRID_START_HOUR,
);
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const TB_MIME = "application/x-timeblock";
const BACKLOG_MIME = "application/x-backlog-item";
const ROW_H = 64; // px — keep in sync with the h-16 row class

export type Orientation = "grid" | "day";

/**
 * Week calendar table ("grid": days across, hours down) plus a single-day
 * column ("day"). Orientation lives in the `?view=` URL param. Blocks can
 * span multiple hours (duration stepper in the cell editor); covered cells
 * render empty and click through to the owning block. Event blocks are
 * draggable between cells and backlog items can be dropped onto cells;
 * moves are optimistic with a settle "pop" and rollback on failure.
 */
export function WeekCalendar({
  week,
  today,
  selectedDate,
  orientation,
  initialNowMinutes,
}: {
  week: WeekPlannerDTO;
  today: string;
  selectedDate: string;
  orientation: Orientation;
  initialNowMinutes: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [editorAnchor, setEditorAnchor] = useState<AnchorRect | null>(null);
  const [justMoved, setJustMoved] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Optimistic block positions; resynced when the server payload changes.
  const [localDays, setLocalDays] = useState(week.days);
  const [prevWeekDays, setPrevWeekDays] = useState(week.days);
  if (week.days !== prevWeekDays) {
    setPrevWeekDays(week.days);
    setLocalDays(week.days);
  }

  const coverageByDate = useMemo(
    () => new Map(localDays.map((d) => [d.date, coverageMap(d.timeBlocks)])),
    [localDays],
  );

  const goto = (date: string, view: Orientation) =>
    router.replace(`/today?date=${date}&view=${view}`);

  /* ------------------------------ dnd ------------------------------- */

  const parseCellAttr = (value: string | null): CellRef | null => {
    if (!value) return null;
    const [date, h] = value.split("|");
    const hour = Number(h);
    return isValidDateKey(date) && Number.isInteger(hour) ? { date, hour } : null;
  };

  const clearMarks = (container: HTMLElement) => {
    container
      .querySelectorAll(".g-cell-drop")
      .forEach((el) => el.classList.remove("g-cell-drop"));
    container
      .querySelectorAll(".g-dragging")
      .forEach((el) => el.classList.remove("g-dragging"));
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const btn = target.closest("[data-block]");
    if (!(btn instanceof HTMLElement)) return;
    const ref = parseCellAttr(btn.closest("[data-cell]")?.getAttribute("data-cell") ?? null);
    if (!ref) return;
    e.dataTransfer.setData(TB_MIME, JSON.stringify(ref));
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setDragImage(btn, 12, 12);
    btn.classList.add("g-dragging");
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const isTb = e.dataTransfer.types.includes(TB_MIME);
    const isBacklog = e.dataTransfer.types.includes(BACKLOG_MIME);
    if (!isTb && !isBacklog) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const container = e.currentTarget;
    container
      .querySelectorAll(".g-cell-drop")
      .forEach((el) => el.classList.remove("g-cell-drop"));
    const cell = (e.target as HTMLElement).closest("[data-cell]");
    if (cell) cell.classList.add("g-cell-drop");
  };

  const flashPop = (key: string) => {
    setJustMoved(key);
    const t = setTimeout(() => setJustMoved(null), 450);
    return () => clearTimeout(t);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const isTb = e.dataTransfer.types.includes(TB_MIME);
    const isBacklog = e.dataTransfer.types.includes(BACKLOG_MIME);
    if (!isTb && !isBacklog) return;
    e.preventDefault();
    const container = e.currentTarget;
    clearMarks(container);

    const to = parseCellAttr(
      (e.target as HTMLElement).closest("[data-cell]")?.getAttribute("data-cell") ?? null,
    );
    if (!to) return;

    if (isBacklog) {
      let payload: { id: string; goalId: string; title: string } | null = null;
      try {
        payload = JSON.parse(e.dataTransfer.getData(BACKLOG_MIME));
      } catch {
        return;
      }
      if (!payload) return;
      const newBlock: TimeBlockDTO = {
        id: `temp-${crypto.randomUUID()}`,
        hour: to.hour,
        span: 1,
        task: payload.title,
        goalIds: [payload.goalId],
        done: false,
      };
      const snapshot = localDays;
      const next = addBlockLocal(localDays, to, newBlock);
      if (!next) {
        toast.info("That slot already has a task");
        return;
      }
      setLocalDays(next);
      flashPop(`${to.date}|${to.hour}`);
      void planBacklogItem({ backlogItemId: payload.id, date: to.date, hour: to.hour }).then(
        (res) => {
          if (!res.success) {
            setLocalDays(snapshot);
            toast.error(res.error);
          }
        },
      );
      return;
    }

    let from: CellRef | null = null;
    try {
      from = JSON.parse(e.dataTransfer.getData(TB_MIME)) as CellRef;
    } catch {
      return;
    }
    if (!from || (from.date === to.date && from.hour === to.hour)) return;

    const snapshot = localDays;
    const next = moveBlockLocal(localDays, from, to);
    if (!next) {
      toast.info("That slot overlaps another task");
      return;
    }
    setLocalDays(next);
    flashPop(`${to.date}|${to.hour}`);
    void moveTimeBlock({ from, to }).then((res) => {
      if (!res.success) {
        setLocalDays(snapshot);
        setJustMoved(null);
        toast.error(res.error);
      }
    });
  };

  const onDragEnd = (e: React.DragEvent<HTMLDivElement>) => clearMarks(e.currentTarget);

  /* ---------------------------- resizing ---------------------------- */

  const maxSpanFor = (date: string, hour: number): number => {
    const day = localDays.find((d) => d.date === date);
    if (!day) return 1;
    let span = 1;
    while (span < 18 && rangeFree(day.timeBlocks, hour, span + 1, hour)) span++;
    return span;
  };

  const resizeBlock = (at: CellRef, span: number) => {
    const snapshot = localDays;
    const next = resizeBlockLocal(localDays, at, span);
    if (!next) {
      toast.info("That overlaps another task");
      return;
    }
    setLocalDays(next);
    void setTimeBlockSpan({ ...at, span }).then((res) => {
      if (!res.success) {
        setLocalDays(snapshot);
        toast.error(res.error);
      }
    });
  };

  const unlinkGoal = (at: CellRef, goalId: string) => {
    const block = localDays
      .find((d) => d.date === at.date)
      ?.timeBlocks.find((b) => b.hour === at.hour);
    if (!block) return;
    const snapshot = localDays;
    const next = patchBlockLocal(localDays, at, {
      goalIds: block.goalIds.filter((id) => id !== goalId),
    });
    if (!next) return;
    setLocalDays(next);
    void unlinkGoalFromTimeBlock({ ...at, goalId }).then((res) => {
      if (!res.success) {
        setLocalDays(snapshot);
        toast.error(res.error);
      }
    });
  };

  const toggleDone = (at: CellRef) => {
    const block = localDays
      .find((d) => d.date === at.date)
      ?.timeBlocks.find((b) => b.hour === at.hour);
    if (!block) return;
    const snapshot = localDays;
    const next = patchBlockLocal(localDays, at, { done: !block.done });
    if (!next) return;
    setLocalDays(next);
    void toggleTimeBlockDone(at).then((res) => {
      if (!res.success) {
        setLocalDays(snapshot);
        toast.error(res.error);
      }
    });
  };

  const deleteBlock = (at: CellRef) => {
    const snapshot = localDays;
    const next = removeBlockLocal(localDays, at);
    setEditing(null);
    if (!next) return;
    setLocalDays(next);
    void deleteTimeBlock(at).then((res) => {
      if (!res.success) {
        setLocalDays(snapshot);
        toast.error(res.error);
      } else {
        toast.success("Task deleted");
      }
    });
  };

  /* ---------------------------- render ------------------------------ */

  const cellProps = (date: string, hour: number) => {
    const coverage = coverageByDate.get(date)?.get(hour);
    const startBlock = coverage?.isStart ? (coverage.block ?? undefined) : undefined;
    const startHour = coverage?.block ? coverage.block.hour : hour;
    // The editor renders only at the cell whose own hour is being edited —
    // editing.hour is always the block's START hour (onEdit maps covered
    // clicks to the start), so a covered cell must not claim the editor.
    const isEditingThis = editing?.date === date && editing.hour === hour;
    return {
      date,
      hour,
      block: startBlock,
      coveredBy: coverage && !coverage.isStart ? (coverage.block ?? null) : null,
      isToday: date === today,
      isSelected: date === selectedDate,
      isEditing: isEditingThis,
      anchor: isEditingThis ? editorAnchor : null,
      onEdit: (el: HTMLElement | null) => {
        setEditing({ date, hour: startHour });
        setEditorAnchor(measureAnchor(el));
      },
      onClose: () => {
        setEditing(null);
        setEditorAnchor(null);
      },
      pop: justMoved === `${date}|${hour}`,
      maxSpan: startBlock ? maxSpanFor(date, startHour) : 1,
      onResize: (span: number) => resizeBlock({ date, hour: startHour }, span),
      onDelete: () => deleteBlock({ date, hour: startHour }),
      onToggleDone: () => toggleDone({ date, hour: startHour }),
      onUnlinkGoal: (goalId: string) => unlinkGoal({ date, hour: startHour }, goalId),
      initialNowMinutes,
    };
  };

  // Land the scroll position near "now" when this week is on screen.
  const weekHasToday = localDays.some((d) => d.date === today);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !weekHasToday) return;
    const nowH = new Date().getHours();
    if (nowH <= HOURS[0] + 1 || nowH >= HOURS[HOURS.length - 1]) return;
    el.scrollTop = (nowH - HOURS[0] - 1) * ROW_H;
  }, [orientation, weekHasToday]);

  return (
    <div
      className="g-enter flex h-[70dvh] flex-col rounded-block bg-surface p-2.5 shadow-block sm:p-4 lg:h-auto lg:min-h-0 lg:flex-1"
      style={{ "--stagger": "80ms" } as React.CSSProperties}
    >
      {/* Toolbar — view switch only; day/week stepping lives in the page header */}
      <div className="mb-2 flex shrink-0 items-center justify-end gap-2 px-1">
        <div
          role="group"
          aria-label="Calendar view"
          className="flex rounded-chip bg-surface-recessed p-0.5"
        >
          <OrientationButton
            active={orientation === "day"}
            onClick={() => goto(selectedDate, "day")}
            label="Day"
            icon={<CalendarDays size={13} strokeWidth={2.25} />}
          />
          <OrientationButton
            active={orientation === "grid"}
            onClick={() => goto(selectedDate, "grid")}
            label="Week"
            icon={<LayoutGrid size={13} strokeWidth={2.25} />}
          />
        </div>
      </div>

      {/* Week strip — fixed context header in Day view */}
      {orientation === "day" && (
        <WeekStrip
          days={localDays}
          today={today}
          selectedDate={selectedDate}
          onSelect={(date) => goto(date, "day")}
        />
      )}

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-auto sm:overflow-x-hidden"
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        {orientation === "grid" && (
          // Below sm: fixed-width day columns + horizontal swipe (gutter stays
          // sticky). sm and up: fluid columns fill the container.
          <div className="grid grid-cols-[44px_repeat(7,minmax(64px,1fr))] sm:grid-cols-[52px_repeat(7,minmax(0,1fr))]">
            <div className="sticky top-0 left-0 z-30 bg-surface" />
            {localDays.map((day, i) => (
              <DayHeader
                key={day.date}
                weekday={WEEKDAYS[i]}
                date={day.date}
                isToday={day.date === today}
                isSelected={day.date === selectedDate}
              />
            ))}
            {HOURS.map((hour) => (
              <Fragment key={hour}>
                <HourGutter hour={hour} />
                {localDays.map((day) => (
                  <Cell key={day.date} {...cellProps(day.date, hour)} />
                ))}
              </Fragment>
            ))}
          </div>
        )}

        {orientation === "day" && (
          <div className="grid grid-cols-[44px_minmax(0,1fr)] sm:grid-cols-[52px_minmax(0,1fr)]">
            {HOURS.map((hour) => (
              <Fragment key={hour}>
                <HourGutter hour={hour} />
                <Cell {...cellProps(selectedDate, hour)} />
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OrientationButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
        active
          ? "bg-surface text-text-primary shadow-block"
          : "text-text-secondary hover:text-text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function DayHeader({
  weekday,
  date,
  isToday,
  isSelected,
}: {
  weekday: string;
  date: string;
  isToday: boolean;
  isSelected: boolean;
}) {
  const dayNum = Number(date.split("-")[2]);
  return (
    <div className="sticky top-0 z-20 flex flex-col items-center gap-1 bg-surface pt-1.5 pb-2.5">
      <span className="text-xs font-medium tracking-wide text-text-secondary">
        {weekday}
      </span>
      <DayNumber dayNum={dayNum} isToday={isToday} isSelected={isSelected} />
    </div>
  );
}

function DayNumber({
  dayNum,
  isToday,
  isSelected,
}: {
  dayNum: number;
  isToday: boolean;
  isSelected: boolean;
}) {
  return (
    <span
      aria-current={isToday ? "date" : undefined}
      className={`flex h-8 w-8 items-center justify-center rounded-none text-sm font-semibold tabular-nums ${
        isToday
          ? "bg-primary text-primary-foreground"
          : isSelected
            ? "text-primary ring-2 ring-primary/40"
            : "text-text-primary"
      }`}
    >
      {dayNum}
    </span>
  );
}

/** Sticky left-hand time gutter cell. */
function HourGutter({ hour }: { hour: number }) {
  return (
    <div className="sticky left-0 z-10 h-16 border-t border-border bg-surface pr-2 pt-1 text-right text-xs font-medium text-text-secondary tabular-nums">
      {hourLabel(hour)}
    </div>
  );
}

/**
 * Compact week strip shown in Day view: single-letter weekdays, day numbers,
 * a dot under days with content. Clicking switches the Day view to that date.
 */
function WeekStrip({
  days,
  today,
  selectedDate,
  onSelect,
}: {
  days: DayPlannerDTO[];
  today: string;
  selectedDate: string;
  onSelect(date: string): void;
}) {
  return (
    <div className="mb-1 grid shrink-0 grid-cols-7 gap-1 px-1">
      {days.map((day, i) => {
        const isToday = day.date === today;
        const isSelected = day.date === selectedDate;
        const hasContent = day.timeBlocks.length > 0;
        return (
          <button
            key={day.date}
            type="button"
            onClick={() => onSelect(day.date)}
            aria-label={`View ${dayFullLabel(day.date)}`}
            aria-current={isSelected ? "date" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-none py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              isSelected ? "bg-primary-subtle" : "hover:bg-surface-recessed"
            }`}
          >
            <span className="text-[10px] font-medium tracking-wide text-text-secondary">
              {WEEKDAYS[i][0]}
            </span>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-none text-xs font-semibold tabular-nums ${
                isToday
                  ? "bg-primary text-primary-foreground"
                  : isSelected
                    ? "text-primary"
                    : "text-text-primary"
              }`}
            >
              {Number(day.date.split("-")[2])}
            </span>
            <span
              className={`h-1 w-1 rounded-none ${
                hasContent ? "bg-text-secondary" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Cell({
  date,
  hour,
  block,
  coveredBy,
  isToday,
  isSelected,
  isEditing,
  anchor,
  onEdit,
  onClose,
  pop,
  maxSpan,
  onResize,
  onDelete,
  onToggleDone,
  onUnlinkGoal,
  initialNowMinutes,
}: {
  date: string;
  hour: number;
  block?: TimeBlockDTO;
  /** This cell is inside another block's span — render empty, click through. */
  coveredBy: TimeBlockDTO | null;
  isToday: boolean;
  isSelected: boolean;
  isEditing: boolean;
  /** Measured anchor rect for the portalled editor (null when not editing). */
  anchor: AnchorRect | null;
  onEdit(el: HTMLElement | null): void;
  onClose(): void;
  pop: boolean;
  maxSpan: number;
  onResize(span: number): void;
  onDelete(): void;
  onToggleDone(): void;
  onUnlinkGoal(goalId: string): void;
  initialNowMinutes: number;
}) {
  const dayName = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
  const cellRef = useRef<HTMLDivElement>(null);

  // Two-step delete arm; resets whenever the editor closes (render-phase adjust).
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [wasEditing, setWasEditing] = useState(isEditing);
  if (isEditing !== wasEditing) {
    setWasEditing(isEditing);
    setDeleteArmed(false);
  }

  // Anchor the editor at the block's START cell even when a covered cell
  // was clicked (find it via data-cell). Falls back to this cell.
  const openEditor = () => {
    const startHour = block?.hour ?? coveredBy?.hour ?? hour;
    const el =
      startHour === hour
        ? cellRef.current
        : document.querySelector(`[data-cell="${date}|${startHour}"]`);
    onEdit(el instanceof HTMLElement ? el : null);
  };

  return (
    <div
      ref={cellRef}
      data-cell={`${date}|${hour}`}
      className={`relative h-16 border-t border-l border-border p-0.5 ${
        isSelected && !isToday ? "bg-primary-subtle/30" : ""
      }`}
    >
      {isToday && <NowLine hour={hour} initialNowMinutes={initialNowMinutes} />}

      {/* The editor is PORTALLED (AnchoredPopover): as an in-cell absolute
          overlay it got clipped by the scroller near grid edges, which made
          the duration steppers intermittently unclickable. */}
      {isEditing && anchor && (
        <AnchoredPopover
          anchor={anchor}
          prefer="below"
          width={240}
          onClose={onClose}
          ignoreRef={cellRef}
          className="rounded-none border-2 border-border bg-surface-recessed shadow-float"
        >
          <div className="w-60 p-1.5">
            <GoalMentionInput
              date={date}
              hour={hour}
              initialTask={block?.task ?? ""}
              autoFocus
              onRequestClose={onClose}
            />
            {block && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[10px] font-medium tracking-wide text-text-secondary uppercase">
                  Duration
                </span>
                <span className="flex items-center gap-1">
                  <StepperButton
                    label="Shrink by an hour"
                    disabled={block.span <= 1}
                    onClick={() => onResize(block.span - 1)}
                  >
                    <Minus size={11} strokeWidth={2.5} />
                  </StepperButton>
                  <span className="min-w-8 text-center text-xs font-semibold tabular-nums">
                    {block.span}h
                  </span>
                  <StepperButton
                    label="Extend by an hour"
                    disabled={block.span >= maxSpan}
                    onClick={() => onResize(block.span + 1)}
                  >
                    <Plus size={11} strokeWidth={2.5} />
                  </StepperButton>
                </span>
                <button
                  type="button"
                  aria-label={deleteArmed ? "Click again to confirm delete" : "Delete task"}
                  title={deleteArmed ? "Click again to confirm" : "Delete task"}
                  onMouseDown={(e) => e.preventDefault()} // keep editor focus
                  onClick={() => {
                    if (!deleteArmed) {
                      setDeleteArmed(true);
                      return;
                    }
                    onDelete();
                  }}
                  className={`ml-auto flex h-5 items-center justify-center gap-0.5 rounded-none border-2 border-border px-1 text-[10px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                    deleteArmed
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {deleteArmed ? "Sure?" : <Trash2 size={11} strokeWidth={2.5} />}
                </button>
              </div>
            )}
            {block && block.goalIds.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {block.goalIds.map((goalId) => (
                  <GoalChip
                    key={goalId}
                    goalId={goalId}
                    onRemove={() => onUnlinkGoal(goalId)}
                  />
                ))}
              </div>
            )}
          </div>
        </AnchoredPopover>
      )}

      {coveredBy ? (
        <button
          type="button"
          onClick={openEditor}
          aria-label={`Edit ${dayName} ${hourLabel(hour)}: ${
            coveredBy.task || "linked goal"
          } (continues from ${hourLabel(coveredBy.hour)})`}
          className="h-full w-full focus-visible:outline-2 focus-visible:outline-primary"
        />
      ) : block ? (
        <div
          role="button"
          tabIndex={0}
          draggable
          data-block
          onClick={openEditor}
          onKeyDown={(e) => {
            if (e.key === "Enter") openEditor();
          }}
          aria-label={`Edit ${dayName} ${hourLabel(hour)}: ${block.task || "linked goal"}${
            block.span > 1 ? ` (${block.span}h)` : ""
          }${block.done ? " (done)" : ""}`}
          aria-pressed={block.done}
          style={{ height: `calc(${block.span} * ${ROW_H}px - 4px)` }}
          className={`g-event g-drag-handle absolute inset-x-0.5 top-0.5 z-10 flex cursor-pointer flex-col justify-start gap-0.5 overflow-hidden rounded-none border-2 border-border bg-surface-recessed px-1.5 py-1 text-left hover:bg-surface-recessed-2 focus-visible:outline-2 focus-visible:outline-primary ${
            pop ? "g-pop" : ""
          } ${block.done ? "opacity-60" : ""}`}
        >
          {block.task.length > 0 && (
            <span
              className={`line-clamp-2 text-xs leading-snug font-medium ${
                block.done ? "text-text-secondary line-through" : "text-text-primary"
              }`}
            >
              {block.task}
            </span>
          )}
          {block.goalIds.length > 0 && (
            <span className="flex flex-wrap gap-0.5">
              {block.goalIds.map((goalId) => (
                <MiniGoalChip key={goalId} goalId={goalId} />
              ))}
            </span>
          )}
          {block.span > 1 && (
            <span className="mt-auto self-start rounded-none bg-surface px-1 py-px text-[9px] font-semibold text-text-secondary tabular-nums">
              {block.span}h
            </span>
          )}
          {/* did-it checkbox — nested in the div, isolated from click/drag */}
          <button
            type="button"
            role="checkbox"
            aria-checked={block.done}
            aria-label={block.done ? "Mark as not done" : "Mark as done"}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleDone();
            }}
            className={`absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-none border-2 transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              block.done
                ? "border-success bg-success text-white"
                : "border-text-secondary/50 bg-surface text-transparent hover:border-text-secondary"
            }`}
          >
            <Check size={10} strokeWidth={4} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openEditor}
          aria-label={`Add task ${dayName} at ${hourLabel(hour)}`}
          className="h-full w-full rounded-none transition-colors hover:bg-primary-subtle focus-visible:bg-primary-subtle focus-visible:outline-none"
        />
      )}
    </div>
  );
}

function StepperButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor focus
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded-none border-2 border-border bg-surface text-text-secondary transition-colors enabled:hover:text-text-primary disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

/** Compact view-mode chip (no remove button — unlink from the cell editor). */
function MiniGoalChip({ goalId }: { goalId: string }) {
  const { byId } = useGoalTreeState();
  const title = byId.get(goalId)?.title ?? "goal";
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "goal";
  return (
    <GoalHoverCard goalId={goalId} hint="Click the block to edit or remove tags">
      <span className="max-w-full truncate rounded-none bg-primary px-1 py-px text-[9px] font-semibold text-primary-foreground">
        #{slug}
      </span>
    </GoalHoverCard>
  );
}

/** Accent line marking the current time across today's column. */
function NowLine({
  hour,
  initialNowMinutes,
}: {
  hour: number;
  initialNowMinutes: number;
}) {
  const [nowMinutes, setNowMinutes] = useState(initialNowMinutes);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const start = HOURS[0] * 60;
  const end = (HOURS[HOURS.length - 1] + 1) * 60;
  if (nowMinutes < start || nowMinutes >= end) return null;
  const rowStart = hour * 60;
  if (nowMinutes < rowStart || nowMinutes >= rowStart + 60) return null;

  const pct = ((nowMinutes - rowStart) / 60) * 100;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-0 left-0 z-20"
      style={{ top: `${pct}%` }}
    >
      <span className="absolute top-[-2px] right-0 left-0 h-0.5 rounded-none bg-primary" />
      <span className="absolute top-[-4px] left-[-3px] h-2 w-2 rounded-none bg-primary" />
    </span>
  );
}
