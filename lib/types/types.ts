export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** ISO date string, e.g. "2026-08-28" */
  dueDate?: string;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
export interface TaskDTO {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  taskListId: string;
}

export interface TaskListDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Included on the index page for a quick count badge; absent elsewhere. */
  taskCount?: number;
}
