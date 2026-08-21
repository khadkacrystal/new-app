import { TasksPage } from "@/components/TasksPage";
import { prisma } from "@/lib/prisma";
import { getTasks } from "@/lib/actions/tasks";
import { notFound } from "next/navigation";

export default async function TaskListRoute({
  params,
}: {
  params: { id: string };
}) {
  const taskList = await prisma.taskList.findUnique({
    where: { id: params.id },
  });
  if (!taskList) notFound();

  const tasks = await getTasks(taskList.id);

  return (
    <TasksPage
      taskListId={taskList.id}
      taskListName={taskList.name}
      initialTasks={tasks}
    />
  );
}
