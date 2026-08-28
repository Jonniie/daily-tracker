import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const u = "local-user";
const key = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today = new Date();
const sunday = new Date(today); sunday.setDate(today.getDate() - today.getDay());

// goals (leaf goals for links)
const work = await prisma.goal.create({ data: { title: "jego work", category: "Work", userId: u, order: 0 } });
const ocpp = await prisma.goal.create({ data: { title: "ocpp work", parentId: work.id, userId: u, order: 0 } });
const ticket = await prisma.goal.create({ data: { title: "commit last set of changes", parentId: ocpp.id, userId: u, order: 0 } });
const gym = await prisma.goal.create({ data: { title: "gym", category: "Personal", userId: u, order: 1 } });

// blocks across the week: yesterday, today (current hour!), tomorrow
const mk = async (date, entries, backlog = []) => {
  const note = await prisma.dailyNote.upsert({ where: { userId_date: { userId: u, date: key(date) } }, create: { userId: u, date: key(date) }, update: {} });
  for (const [hour, task, goalId] of entries) {
    const b = await prisma.timeBlock.create({ data: { dailyNoteId: note.id, hour, task } });
    if (goalId) await prisma.timeBlockGoal.create({ data: { timeBlockId: b.id, goalId } });
  }
  for (const goalId of backlog) await prisma.backlogItem.create({ data: { dailyNoteId: note.id, goalId } });
};
const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
await mk(yesterday, [[9, "fix create driver flow", ticket.id], [18, "gym session", gym.id]]);
await mk(today, [[8, "standup + review PRs", null], [Math.min(23, Math.max(6, today.getHours())), "work on daily-tracker", ticket.id]], [gym.id]);
await mk(tomorrow, [[10, "algo lecture", null]]);
console.log("seeded week; today block at hour", Math.min(23, Math.max(6, today.getHours())));
await prisma.$disconnect();
