"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Page,
  FilterBar,
  IndexTable,
  Checkbox,
  Badge,
  Button,
  IconButton,
  EmptyState,
  useConfirm,
  type IndexTableColumn,
  type FilterField,
  type FilterValue,
  type BulkAction,
} from "@flashmandu/app-bridge-ui/react";
import {
  createTask,
  deleteTask,
  deleteTasks,
  setTasksCompleted,
  toggleTaskCompleted,
  updateTaskTitle,
} from "@/lib/actions/tasks";
import { TaskDTO } from "@/lib/types/types";
import { TaskFormModal } from "./TaskFormModal";
import { NewTaskListModal } from "./TaskListModal";
import { createTaskList } from "@/lib/actions/taskLists";
import Link from "next/link";

const IconPencil = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.7}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
    />
  </svg>
);
const IconTrash = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.7}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.206 5.79 18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79M4.77 5.79c.342-.059.683-.114 1.024-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916"
    />
  </svg>
);

const FILTER_FIELDS: FilterField[] = [
  {
    key: "status",
    label: "Status",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All", value: "all" },
      { label: "To do", value: "todo" },
      { label: "Done", value: "done" },
    ],
  },
];

export interface TasksPageProps {
  taskListId: string;
  taskListName: string;
  /** Server-fetched, serialized tasks for this list. */
  initialTasks: TaskDTO[];
}

export function TasksPage({
  taskListId,
  taskListName,
  initialTasks,
}: TasksPageProps) {
  const router = useRouter();
  const [tasks, setTasks] = React.useState<TaskDTO[]>(initialTasks);
  const [query, setQuery] = React.useState("");
  const [filterValues, setFilterValues] = React.useState<
    Record<string, FilterValue>
  >({
    status: "all",
  });
  const [selected, setSelected] = React.useState<(string | number)[]>([]);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingTask, setEditingTask] = React.useState<TaskDTO | null>(null);
  const [listModalOpen, setListModalOpen] = React.useState(false);
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());

  const { confirm, dialog } = useConfirm();

  // Keep local state in sync if the server component re-fetches (e.g. after
  // a revalidatePath triggers a re-render higher up).
  React.useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (q && !task.title.toLowerCase().includes(q)) return false;
      const status = filterValues.status;
      if (status === "todo" && task.completed) return false;
      if (status === "done" && !task.completed) return false;
      return true;
    });
  }, [tasks, query, filterValues]);

  function markPending(id: string, isPending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openCreateModal() {
    setEditingTask(null);
    setModalOpen(true);
  }

  function openEditModal(task: TaskDTO) {
    setEditingTask(task);
    setModalOpen(true);
  }

  async function handleFormSubmit(title: string) {
    if (editingTask) {
      const updated = await updateTaskTitle(editingTask.id, title);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } else {
      const created = await createTask(taskListId, title);
      setTasks((prev) => [created, ...prev]);
    }
  }

  async function toggleDone(task: TaskDTO) {
    // Optimistic flip, corrected if the server call fails.
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, completed: !t.completed } : t,
      ),
    );
    markPending(task.id, true);
    try {
      const updated = await toggleTaskCompleted(task.id);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, completed: task.completed } : t,
        ),
      );
    } finally {
      markPending(task.id, false);
    }
  }

  async function handleDeleteTask(task: TaskDTO) {
    const ok = await confirm({
      title: `Delete "${task.title}"?`,
      body: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await deleteTask(task.id);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    setSelected((prev) => prev.filter((id) => id !== task.id));
  }

  async function handleDeleteSelected(ids: (string | number)[]) {
    const stringIds = ids.map(String);
    const ok = await confirm({
      title: `Delete ${stringIds.length} task${stringIds.length === 1 ? "" : "s"}?`,
      body: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await deleteTasks(stringIds);
    setTasks((prev) => prev.filter((t) => !stringIds.includes(t.id)));
    setSelected([]);
  }

  async function handleMarkSelectedDone(ids: (string | number)[]) {
    const stringIds = ids.map(String);
    await setTasksCompleted(stringIds, true);
    setTasks((prev) =>
      prev.map((t) =>
        stringIds.includes(t.id) ? { ...t, completed: true } : t,
      ),
    );
    setSelected([]);
  }

  const bulkActions: BulkAction[] = [
    { key: "done", label: "Mark as done", onAction: handleMarkSelectedDone },
    {
      key: "delete",
      label: "Delete",
      destructive: true,
      onAction: handleDeleteSelected,
    },
  ];

  // "actions" column removed — row actions now render via IndexTable's
  // rowActions prop, matching ItemsPage's icon-button treatment.
  const columns: IndexTableColumn<TaskDTO>[] = [
    {
      key: "title",
      label: "Task",
      pinned: true,
      render: (task) => (
        <span
          style={{
            textDecoration: task.completed ? "line-through" : "none",
          }}
        >
          {task.title}
        </span>
      ),
    },
    {
      key: "marked",
      label: "Marked",
      render: (task) => (
        <Button
          variant={task.completed ? "primary" : "subtle"}
          size="sm"
          onClick={() => toggleDone(task)}
          disabled={pendingIds.has(task.id)}
        >
          {task.completed ? "Completed" : "To do"}
        </Button>
      ),
    },
    {
      key: "updatedAt",
      label: "Updated",
      render: (task) => new Date(task.updatedAt).toLocaleDateString(),
    },
  ];

  return (
    <Page
      title={taskListName}
      crumbs={[
        {
          label: "Task lists",
          path: "/tasklists",
        },
        {
          label: taskListName,
        },
      ]}
      linkComponent={Link}
    >
      <FilterBar
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Search tasks",
        }}
        fields={FILTER_FIELDS}
        values={filterValues}
        onChange={(key, value) =>
          setFilterValues((prev) => ({ ...prev, [key]: value }))
        }
        onClear={() => setFilterValues({ status: "all" })}
        actions={
          <>
            <Button variant="subtle" onClick={() => setListModalOpen(true)}>
              New list
            </Button>
            <Button variant="primary" onClick={openCreateModal}>
              New task
            </Button>
          </>
        }
      />

      <IndexTable<TaskDTO>
        columns={columns}
        data={filtered}
        keyExtractor={(task) => task.id}
        selectable
        selected={selected}
        onSelectionChange={setSelected}
        bulkActions={bulkActions}
        label="Tasks"
        rowActions={(task) => (
          <>
            <IconButton
              variant="edit"
              label="Rename"
              onClick={() => openEditModal(task)}
            >
              <IconPencil />
            </IconButton>
            <IconButton
              variant="delete"
              label="Delete"
              onClick={() => handleDeleteTask(task)}
            >
              <IconTrash />
            </IconButton>
          </>
        )}
        emptyState={
          <EmptyState
            title="No tasks match these filters"
            description="Try clearing your filters, or add a new task to get started."
            action={
              <Button variant="primary" size="sm" onClick={openCreateModal}>
                New task
              </Button>
            }
          />
        }
      />

      <TaskFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        task={editingTask}
        onSubmit={handleFormSubmit}
      />

      <NewTaskListModal
        open={listModalOpen}
        onClose={() => setListModalOpen(false)}
        onSubmit={(name) => createTaskList(name)}
        onCreated={(list) => router.push(`/tasklists/${list.id}`)}
      />

      {dialog}
    </Page>
  );
}
