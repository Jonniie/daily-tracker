"use client";

import { useState } from "react";
import { Check, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { sendGoalToBacklog } from "@/app/actions/planner";

/**
 * Leaf-goal action: copy this goal into today's Extras list without
 * leaving /goals. Hover-revealed; briefly flashes a sage check on success.
 */
export function SendToBacklogButton({
  goalId,
  isLeaf,
}: {
  goalId: string;
  isLeaf: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  if (!isLeaf) return null;

  const send = async () => {
    if (state !== "idle") return;
    setState("sending");
    try {
      const res = await sendGoalToBacklog({ goalId });
      if (!res.success) {
        toast.error(res.error);
      } else if (res.data.already) {
        toast.info("Already in Extras");
      } else {
        toast.success("Sent to Extras");
      }
      setState(res.success ? "sent" : "idle");
    } catch {
      toast.error("Network error — not sent");
      setState("idle");
      return;
    }
    setTimeout(() => setState("idle"), 1500);
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Send to Extras"
      title="Send to Extras"
      onMouseDown={(e) => e.preventDefault()} // don't steal editor focus
      onClick={send}
      disabled={state === "sending"}
      className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-chip transition-all focus-visible:opacity-100 group-hover/item:opacity-100 ${
        state === "sent"
          ? "text-success opacity-100"
          : "text-text-secondary opacity-0 hover:bg-surface-recessed-2 hover:text-text-primary"
      }`}
    >
      {state === "sent" ? (
        <Check size={13} strokeWidth={3} />
      ) : (
        <ListPlus size={13} strokeWidth={2.25} />
      )}
    </button>
  );
}
