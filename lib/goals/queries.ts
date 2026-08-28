import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { buildTree } from "./tree";
import type { GoalNode } from "./types";

/**
 * Fetch the caller's full goal forest in one query and nest it server-side.
 *
 * Deliberately lives outside `app/actions/` — a `'use server'` module turns
 * every export into a client-invocable endpoint, and queries don't need that
 * surface. Server components call this directly.
 */
export async function getGoalTree(): Promise<GoalNode[]> {
  const userId = await getUserId();
  const rows = await prisma.goal.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return buildTree(rows);
}
