/** Caret helpers for the single-text-node contentEditable title editors. */

/** Character offset of the caret within `el` (0 when the selection is elsewhere). */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return el.textContent?.length ?? 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Focus `el` and place the caret at a clamped character offset. */
export function setCaret(el: HTMLElement, pos: number): void {
  const len = el.textContent?.length ?? 0;
  const clamped = Math.max(0, Math.min(pos, len));
  const sel = window.getSelection();
  const range = document.createRange();
  const textNode = el.firstChild;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, Math.min(clamped, textNode.textContent?.length ?? 0));
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(clamped === 0);
  }
  sel?.removeAllRanges();
  sel?.addRange(range);
}
