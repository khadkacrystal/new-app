"use client";

import * as React from "react";
import {
  Modal,
  Field,
  Input,
  Select,
  Button,
} from "@flashmandu/app-bridge-ui/react";
import type { TaskListDTO } from "@/lib/types/types";

export interface QuickAddTaskModalProps {
  open: boolean;
  onClose: () => void;
  taskLists: TaskListDTO[];
  /** Pre-select a list, e.g. when opened from within that list's page. */
  defaultTaskListId?: string;
  onSubmit: (taskListId: string, title: string) => Promise<void>;
}

export function QuickAddTaskModal({
  open,
  onClose,
  taskLists,
  defaultTaskListId,
  onSubmit,
}: QuickAddTaskModalProps) {
  const [title, setTitle] = React.useState("");
  const [taskListId, setTaskListId] = React.useState(
    defaultTaskListId ?? taskLists[0]?.id ?? "",
  );
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setTaskListId(defaultTaskListId ?? taskLists[0]?.id ?? "");
      setError(undefined);
    }
  }, [open, defaultTaskListId, taskLists]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the task a title.");
      return;
    }
    if (!taskListId) {
      setError("Choose a list for this task.");
      return;
    }
    setPending(true);
    try {
      await onSubmit(taskListId, trimmed);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const noLists = taskLists.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      size="sm"
      footer={
        <>
          <Button
            variant="subtle"
            onClick={onClose}
            type="button"
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            type="button"
            loading={pending}
            disabled={noLists}
          >
            Add task
          </Button>
        </>
      }
    >
      {noLists ? (
        <p>Create a task list first, then you can add tasks to it.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <Field label="Title" required error={error}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Write release notes"
              autoFocus
              disabled={pending}
            />
          </Field>
          <Field label="List">
            <Select
              value={taskListId}
              onChange={(e) => setTaskListId(e.target.value)}
              disabled={pending}
            >
              {taskLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      )}
    </Modal>
  );
}
