"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../prisma";
import { TaskDTO } from "../types/types";

type PrismaTask = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
  taskListId: string;
};

function serializeTask(task: PrismaTask): TaskDTO {
  return {
    id: task.id,
    title: task.title,
    completed: task.completed,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    taskListId: task.taskListId,
  };
}

export async function getTasks(taskListId: string): Promise<TaskDTO[]> {
  const tasks = await prisma.task.findMany({
    where: { taskListId },
    orderBy: { createdAt: "desc" },
  });
  return tasks.map(serializeTask);
}

export async function createTask(
  taskListId: string,
  title: string,
): Promise<TaskDTO> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required.");
  const task = await prisma.task.create({
    data: { title: trimmed, taskListId },
  });
  revalidatePath(`/tasklists/${taskListId}`);
  return serializeTask(task);
}

export async function updateTaskTitle(
  id: string,
  title: string,
): Promise<TaskDTO> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required.");
  const task = await prisma.task.update({
    where: { id },
    data: { title: trimmed },
  });
  revalidatePath(`/tasklists/${task.taskListId}`);
  return serializeTask(task);
}

export async function toggleTaskCompleted(id: string): Promise<TaskDTO> {
  const existing = await prisma.task.findUniqueOrThrow({ where: { id } });
  const task = await prisma.task.update({
    where: { id },
    data: { completed: !existing.completed },
  });
  revalidatePath(`/tasklists/${task.taskListId}`);
  return serializeTask(task);
}

export async function deleteTask(id: string): Promise<void> {
  const task = await prisma.task.delete({ where: { id } });
  revalidatePath(`/tasklists/${task.taskListId}`);
}

export async function deleteTasks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const affected = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { taskListId: true },
  });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
  for (const taskListId of new Set(affected.map((t) => t.taskListId))) {
    revalidatePath(`/tasklists/${taskListId}`);
  }
}

export async function setTasksCompleted(
  ids: string[],
  completed: boolean,
): Promise<void> {
  if (ids.length === 0) return;
  await prisma.task.updateMany({
    where: { id: { in: ids } },
    data: { completed },
  });
  const affected = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { taskListId: true },
  });
  for (const taskListId of new Set(affected.map((t) => t.taskListId))) {
    revalidatePath(`/tasklists/${taskListId}`);
  }
}
