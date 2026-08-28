import type { Goal as PrismaGoal } from "@prisma/client";

/** A flat Goal row, as persisted. */
export type Goal = PrismaGoal;

/** Tree-shaped goal: a row plus its nested children (built server-side by `buildTree`). */
export type GoalNode = Goal & { children: GoalNode[] };
