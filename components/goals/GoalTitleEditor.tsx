"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  useGoalFocus,
  useGoalTreeActions,
  useGoalTreeState,
} from "@/components/providers/GoalTreeProvider";
import { getCaretOffset, setCaret } from "@/lib/goals/caret";
import {
  AnchoredPopover,
  measureAnchor,
  type AnchorRect,
} from "@/components/ui/AnchoredPopover";

/**
 * Inline title editor. `contentEditable` (not textarea) because the outliner's
 * Enter-split needs exact cursor offsets, which contentEditable exposes via
 * the Selection API.
 *
 * The DOM is the source of truth while focused (uncontrolled): typing never
 * round-trips through React, so there's zero re-render per keystroke.
 *
 * Typing `#` (start or after whitespace) opens the category assigner — the
 * goals-view tag feature. Picking a tag assigns it and strips the `#fragment`
 * from the title. While open, `data-tag-open` tells the outliner's delegated
 * keydown handler to stand down.
 */
export function GoalTitleEditor({
  id,
  title,
  completed,
  hasChildren,
  hasCategory,
}: {
  id: string;
  title: string;
  completed: boolean;
  hasChildren: boolean;
  hasCategory: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { updateTitle, remove, setCategory } = useGoalTreeActions();
  const { categories } = useGoalTreeState();
  const { focusRequest, clearFocusRequest } = useGoalFocus();
  const savedTitleRef = useRef(title);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `#` category-assigner state
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [tagAnchor, setTagAnchor] = useState<AnchorRect | null>(null);
  const [tagActive, setTagActive] = useState(0);

  const filteredCategories = useMemo(
    () =>
      tagQuery === null
        ? []
        : categories.filter((c) => c.toLowerCase().includes(tagQuery.toLowerCase())),
    [tagQuery, categories],
  );
  const showCreate =
    tagQuery !== null &&
    tagQuery.trim().length > 0 &&
    !categories.some((c) => c.toLowerCase() === tagQuery.trim().toLowerCase());
  const tagOptionCount = filteredCategories.length + (showCreate ? 1 : 0);

  const closeTagPicker = () => {
    setTagQuery(null);
    setTagAnchor(null);
    ref.current?.removeAttribute("data-tag-open");
  };

  const applyTag = (category: string) => {
    const el = ref.current;
    if (el && tagQuery !== null) {
      // Strip "#query" before the caret (plus one joining space), then tidy.
      const text = el.textContent ?? "";
      const caret = getCaretOffset(el);
      let before = text.slice(0, caret);
      before = before.slice(0, before.length - tagQuery.length - 1); // remove "#query"
      if (before.endsWith(" ")) before = before.slice(0, -1);
      const after = text.slice(caret);
      const next = `${before}${after}`.replace(/\s{2,}/g, " ").trim();
      el.textContent = next;
      setCaret(el, before.length);
      if (next.length > 0) updateTitle(id, next);
      // Empty-after-strip is fine: the goal stays untitled with its tag, and
      // the blur guard below spares categorized empty bullets from auto-remove.
    }
    setCategory(id, category);
    closeTagPicker();
  };

  // External title sync — never clobber while the user is typing in it.
  useEffect(() => {
    savedTitleRef.current = title;
    const el = ref.current;
    if (el && document.activeElement !== el && (el.textContent ?? "") !== title) {
      el.textContent = title;
    }
  }, [title]);

  // Consume focus requests addressed to this item.
  useEffect(() => {
    if (!focusRequest || focusRequest.id !== id) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = el.textContent?.length ?? 0;
    const pos =
      focusRequest.caret === "end"
        ? len
        : focusRequest.caret === "start"
          ? 0
          : focusRequest.caret;
    setCaret(el, pos);
    clearFocusRequest();
  }, [focusRequest, id, clearFocusRequest]);

  // Cancel any pending autosave on unmount (blur handles the final write).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const cancelDebounce = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const flush = () => {
    cancelDebounce();
    const text = (ref.current?.textContent ?? "").trim();
    if (text.length > 0 && text !== savedTitleRef.current) {
      updateTitle(id, text);
    }
  };

  return (
    <span className="min-w-0 flex-1">
      <span
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Goal title"
        aria-multiline={false}
        data-goal-editor
        data-placeholder="New goal… (# assigns a tag)"
        spellCheck={false}
        className={`goal-editor min-w-[4ch] block rounded-sm text-[15px] leading-6 outline-none ${
          completed ? "text-text-secondary line-through" : "text-text-primary"
        }`}
        onInput={() => {
          cancelDebounce();
          debounceRef.current = setTimeout(flush, 400);
          // `#` trigger: at start or after whitespace, word chars only.
          const el = ref.current;
          if (!el) return;
          const caret = getCaretOffset(el);
          const match = /(?:^|\s)#([\w-]*)$/.exec(
            (el.textContent ?? "").slice(0, caret),
          );
          if (match) {
            setTagQuery(match[1]);
            setTagAnchor(measureAnchor(el));
            setTagActive(0);
            el.setAttribute("data-tag-open", "");
          } else if (tagQuery !== null) {
            closeTagPicker();
          }
        }}
        onKeyDown={(e) => {
          if (tagQuery !== null) {
            // Tag dropdown owns these keys (the outliner handler stands down
            // via the data-tag-open flag).
            if (e.key === "Escape") {
              e.preventDefault();
              closeTagPicker();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setTagActive((i) => Math.min(i + 1, tagOptionCount - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setTagActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              cancelDebounce();
              const cat = filteredCategories[tagActive];
              if (cat) applyTag(cat);
              else if (showCreate && tagQuery) applyTag(tagQuery.trim());
            } else if (e.key === "Tab") {
              e.preventDefault();
              closeTagPicker();
            }
            return;
          }
          // The container-level outliner handler owns these keys — make sure a
          // pending debounced write can't land after the structural change.
          if (e.key === "Enter" || e.key === "Tab") cancelDebounce();
        }}
        onBlur={() => {
          flush();
          closeTagPicker();
          const el = ref.current;
          if (!el) return;
          const text = (el.textContent ?? "").trim();
          // Empty titles can't persist (updateGoalTitle validates non-empty):
          // an emptied existing title is restored; a never-titled empty bullet
          // is closed — unless it has children or carries a tag (intent shown).
          if (text.length === 0 && savedTitleRef.current.length > 0) {
            el.textContent = savedTitleRef.current;
          } else if (text.length === 0 && !hasChildren && !hasCategory) {
            remove(id);
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = (e.clipboardData.getData("text/plain") ?? "").replace(/\s*\n+\s*/g, " ");
          document.execCommand("insertText", false, text);
        }}
      />

      {tagQuery !== null && tagAnchor && tagOptionCount > 0 && (
        <AnchoredPopover
          anchor={tagAnchor}
          prefer="below"
          onClose={closeTagPicker}
          ignoreRef={ref}
          role="listbox"
          ariaLabel="Assign tag"
          className="max-h-64 min-w-44 overflow-y-auto rounded-sub border-2 border-border bg-surface p-1.5 shadow-float"
        >
          {filteredCategories.map((c, i) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={i === tagActive}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setTagActive(i)}
              onClick={() => applyTag(c)}
              className={`block w-full rounded-none px-2.5 py-1.5 text-left text-sm ${
                i === tagActive
                  ? "bg-primary-subtle text-text-primary"
                  : "text-text-secondary"
              }`}
            >
              {c}
            </button>
          ))}
          {showCreate && tagQuery !== null && (
            <button
              type="button"
              role="option"
              aria-selected={tagActive === filteredCategories.length}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setTagActive(filteredCategories.length)}
              onClick={() => applyTag(tagQuery.trim())}
              className={`flex w-full items-center gap-1.5 rounded-none border-t-2 border-border px-2.5 py-1.5 text-left text-sm font-medium text-primary ${
                tagActive === filteredCategories.length ? "bg-primary-subtle" : ""
              }`}
            >
              <Plus size={13} strokeWidth={2.5} />
              Create tag “{tagQuery.trim()}”
            </button>
          )}
        </AnchoredPopover>
      )}
    </span>
  );
}
