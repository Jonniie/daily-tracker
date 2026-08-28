"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Measure an anchor element at open time (call from an event handler, not render). */
export function measureAnchor(el: HTMLElement | null): AnchorRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

/**
 * Popover rendered in a body portal with fixed coordinates — immune to the
 * overflow clipping and stacking contexts that bury `absolute` dropdowns
 * inside scroll containers. Flips above the anchor when there's no room
 * below (or vice versa for `prefer="above"`), clamps horizontally to the
 * viewport, and closes on any scroll/resize rather than drifting.
 */
export function AnchoredPopover({
  anchor,
  prefer = "below",
  align = "start",
  matchWidth = false,
  width,
  onClose,
  ignoreRef,
  role,
  ariaLabel,
  pointerEventsNone = false,
  className = "",
  children,
}: {
  anchor: AnchorRect;
  prefer?: "above" | "below";
  align?: "start" | "end";
  /** Match the anchor's width (dropdowns under inputs). */
  matchWidth?: boolean;
  /** Exact width (right-alignment math) or max-width cap. */
  width?: number;
  onClose(): void;
  /** The trigger element — clicks inside it (or the popover) don't close. */
  ignoreRef?: RefObject<HTMLElement | null>;
  role?: string;
  ariaLabel?: string;
  /** Tooltips: never steal hover. Pickers keep default (interactive). */
  pointerEventsNone?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountedAtRef = useRef(0);

  // Dismissal is OWNED HERE: the popover lives in a body portal, so any
  // containment check that only knows the trigger's DOM subtree would treat
  // every click inside the popover as "outside" and close before the click
  // lands (this exact bug broke category picking after the portal migration).
  //
  // Grace period: for ~250ms after the popover first mounts, outside
  // mousedowns / scrolls / resizes are IGNORED. Click-opened editors were
  // observed to open-and-instantly-close on real hardware when a rogue
  // same-interaction event (driver-synthesised mousedown, focus-restore,
  // delayed scroll) landed right after mount. Deliberate Escape still closes.
  useEffect(() => {
    if (mountedAtRef.current === 0) mountedAtRef.current = Date.now();
    const inGrace = () => Date.now() - mountedAtRef.current < 250;

    const onScrollOrResize = () => {
      if (inGrace()) return;
      onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (ignoreRef?.current?.contains(target)) return;
      if (inGrace()) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, ignoreRef]);

  const estimatedWidth = matchWidth ? anchor.right - anchor.left : (width ?? 288);

  // Flip math: below-preferred flips when <220px under the anchor and enough
  // above; above-preferred flips when <140px over it.
  const above =
    prefer === "above"
      ? anchor.top > 140
      : window.innerHeight - anchor.bottom < 220 && anchor.top > 220;

  const rawLeft =
    align === "end" && width ? anchor.right - width : anchor.left;
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - estimatedWidth - 8));

  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: 100,
    left,
    top: above ? anchor.top : anchor.bottom,
    transform: above ? "translateY(calc(-100% - 6px))" : "translateY(6px)",
    ...(matchWidth
      ? { width: anchor.right - anchor.left }
      : width
        ? { maxWidth: width }
        : null),
  };

  return createPortal(
    <div
      ref={rootRef}
      data-anchored-popover
      role={role}
      aria-label={ariaLabel}
      className={className}
      style={{
        ...style,
        pointerEvents: pointerEventsNone ? "none" : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
