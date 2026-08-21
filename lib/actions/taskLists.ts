"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../prisma";
import { TaskListDTO } from "../types/types";

export async function getTaskLists(): Promise<TaskListDTO[]> {
  const lists = await prisma.taskList.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { tasks: true } } },
  });
  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    taskCount: list._count.tasks,
  }));
}

export async function createTaskList(name: string): Promise<TaskListDTO> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  const list = await prisma.taskList.create({ data: { name: trimmed } });
  revalidatePath("/tasklists");
  return {
    id: list.id,
    name: list.name,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    taskCount: 0,
  };
}

export async function updateTaskListName(
  id: string,
  name: string,
): Promise<TaskListDTO> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  const list = await prisma.taskList.update({
    where: { id },
    data: { name: trimmed },
    include: { _count: { select: { tasks: true } } },
  });
  revalidatePath("/tasklists");
  revalidatePath(`/tasklists/${id}`);
  return {
    id: list.id,
    name: list.name,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    taskCount: list._count.tasks,
  };
}

export async function deleteTaskList(id: string): Promise<void> {
  // Assumes the Task <-> TaskList relation cascades on delete at the DB
  // level (onDelete: Cascade in schema.prisma). If it doesn't, delete the
  // list's tasks first: await prisma.task.deleteMany({ where: { taskListId: id } });
  await prisma.taskList.delete({ where: { id } });
  revalidatePath("/tasklists");
  revalidatePath(`/tasklists/${id}`);
}
