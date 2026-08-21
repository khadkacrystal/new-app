"use client";

import * as React from "react";
import { Modal, Field, Input, Button } from "@flashmandu/app-bridge-ui/react";
import { TaskDTO } from "@/lib/types/types";

export interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Pass a task to edit its title, or null/undefined to create a new one. */
  task?: TaskDTO | null;
  /** Resolves/rejects based on the server action's outcome. */
  onSubmit: (title: string) => Promise<void>;
}

export function TaskFormModal({
  open,
  onClose,
  task,
  onSubmit,
}: TaskFormModalProps) {
  const [title, setTitle] = React.useState(task?.title ?? "");
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setError(undefined);
    }
  }, [open, task]);

  const isEditing = Boolean(task);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the task a title.");
      return;
    }
    setPending(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Rename task" : "New task"}
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
          >
            {isEditing ? "Save changes" : "Add task"}
          </Button>
        </>
      }
    >
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
      </form>
    </Modal>
  );
}
