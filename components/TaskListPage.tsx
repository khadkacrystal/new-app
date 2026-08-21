"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Page,
  FilterBar,
  IndexTable,
  Button,
  IconButton,
  IconButtonLink,
  EmptyState,
  Badge,
  useConfirm,
  type IndexTableColumn,
} from "@flashmandu/app-bridge-ui/react";
import {
  createTaskList,
  updateTaskListName,
  deleteTaskList,
} from "@/lib/actions/taskLists";
import { createTask } from "@/lib/actions/tasks";
import { NewTaskListModal } from "@/components/TaskListModal";
import { QuickAddTaskModal } from "@/components/QuickAddTaskModal";
import type { TaskListDTO } from "@/lib/types/types";
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
const IconEye = () => (
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
      d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
    />
  </svg>
);

export interface TaskListsPageProps {
  initialTaskLists: TaskListDTO[];
}

export function TaskListsPage({ initialTaskLists }: TaskListsPageProps) {
  const router = useRouter();
  const [taskLists, setTaskLists] = React.useState(initialTaskLists);
  const [query, setQuery] = React.useState("");
  const [listModalOpen, setListModalOpen] = React.useState(false);
  const [editingList, setEditingList] = React.useState<TaskListDTO | null>(
    null,
  );
  const [taskModalOpen, setTaskModalOpen] = React.useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  React.useEffect(() => setTaskLists(initialTaskLists), [initialTaskLists]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return taskLists;
    return taskLists.filter((list) => list.name.toLowerCase().includes(q));
  }, [taskLists, query]);

  function openCreateModal() {
    setEditingList(null);
    setListModalOpen(true);
  }

  function openEditModal(list: TaskListDTO) {
    setEditingList(list);
    setListModalOpen(true);
  }

  async function handleListModalSubmit(name: string) {
    if (editingList) {
      const updated = await updateTaskListName(editingList.id, name);
      setTaskLists((prev) =>
        prev.map((l) => (l.id === updated.id ? updated : l)),
      );
      return updated;
    }
    const created = await createTaskList(name);
    setTaskLists((prev) => [created, ...prev]);
    return created;
  }

  async function handleDeleteList(list: TaskListDTO) {
    const ok = await confirm({
      title: `Delete "${list.name}"?`,
      body: "This will also delete its tasks and can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await deleteTaskList(list.id);
    setTaskLists((prev) => prev.filter((l) => l.id !== list.id));
  }

  async function handleCreateTask(taskListId: string, title: string) {
    await createTask(taskListId, title);
    setTaskLists((prev) =>
      prev.map((list) =>
        list.id === taskListId
          ? { ...list, taskCount: (list.taskCount ?? 0) + 1 }
          : list,
      ),
    );
    router.push(`/tasklists/${taskListId}`);
  }

  const columns: IndexTableColumn<TaskListDTO>[] = [
    { key: "name", label: "Name", pinned: true, render: (list) => list.name },
    {
      key: "taskCount",
      label: "Tasks",
      render: (list) => <Badge tone="neutral">{list.taskCount ?? 0}</Badge>,
    },
  ];

  return (
    <Page
      title="Task lists"
      crumbs={[{ label: "Task Lists", path: "/tasklists" }]}
      linkComponent={Link}
    >
      <FilterBar
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Search task lists",
        }}
        actions={
          <>
            <Button variant="subtle" onClick={() => setTaskModalOpen(true)}>
              New task
            </Button>
            <Button variant="primary" onClick={openCreateModal}>
              New list
            </Button>
          </>
        }
      />

      <IndexTable<TaskListDTO>
        label="Task lists"
        columns={columns}
        data={filtered}
        keyExtractor={(list) => list.id}
        rowActions={(list) => (
          <>
            <IconButton
              variant="edit"
              label="Rename"
              onClick={() => openEditModal(list)}
            >
              <IconPencil />
            </IconButton>
            <IconButtonLink
              href={`/tasklists/${list.id}`}
              variant="view"
              label="View tasks"
            >
              <IconEye />
            </IconButtonLink>
            <IconButton
              variant="delete"
              label="Delete"
              onClick={() => handleDeleteList(list)}
            >
              <IconTrash />
            </IconButton>
          </>
        )}
        emptyState={
          <EmptyState
            title={
              taskLists.length === 0
                ? "No task lists yet"
                : "No lists match your search"
            }
            description={
              taskLists.length === 0
                ? "Create your first list to start adding tasks."
                : "Try a different search term, or clear it to see everything."
            }
            action={
              taskLists.length === 0 ? (
                <Button variant="primary" size="sm" onClick={openCreateModal}>
                  New list
                </Button>
              ) : undefined
            }
          />
        }
      />

      <NewTaskListModal
        open={listModalOpen}
        onClose={() => setListModalOpen(false)}
        taskList={editingList}
        onSubmit={handleListModalSubmit}
        onCreated={(list) =>
          !editingList && router.push(`/tasklists/${list.id}`)
        }
      />

      <QuickAddTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        taskLists={taskLists}
        onSubmit={handleCreateTask}
      />

      {confirmDialog}
    </Page>
  );
}
