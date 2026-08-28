import { getGoalTree } from "@/lib/goals/queries";
import { GoalTreeProvider } from "@/components/providers/GoalTreeProvider";
import { OutlinerRoot } from "@/components/goals/OutlinerRoot";

// Reads SQLite at request time — never prerender at build.
export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const tree = await getGoalTree();
  return (
    <GoalTreeProvider initialTree={tree}>
      <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto pb-16">
        <OutlinerRoot />
      </div>
    </GoalTreeProvider>
  );
}
