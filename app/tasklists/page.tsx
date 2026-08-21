import { TaskListsPage } from "@/components/TaskListPage";
import { getTaskLists } from "@/lib/actions/taskLists";

export default async function TaskListsRoute() {
  const taskLists = await getTaskLists();
  return <TaskListsPage initialTaskLists={taskLists} />;
}
