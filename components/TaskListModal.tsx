"use client";

import * as React from "react";
import { Modal, Field, Input, Button } from "@flashmandu/app-bridge-ui/react";
import type { TaskListDTO } from "@/lib/types/types";

export interface NewTaskListModalProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing an existing list; omitted when creating a new one. */
  taskList?: TaskListDTO | null;
  onSubmit: (name: string) => Promise<TaskListDTO>;
  /** Called with the created/updated list, e.g. to navigate to it. */
  onCreated?: (list: TaskListDTO) => void;
}

export function NewTaskListModal({
  open,
  onClose,
  taskList,
  onSubmit,
  onCreated,
}: NewTaskListModalProps) {
  const isEditing = Boolean(taskList);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(taskList?.name ?? "");
      setError(undefined);
    }
  }, [open, taskList]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the list a name.");
      return;
    }
    setPending(true);
    try {
      const result = await onSubmit(trimmed);
      onClose();
      onCreated?.(result);
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
      title={isEditing ? "Rename task list" : "New task list"}
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
            {isEditing ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Field label="Name" required error={error}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Launch checklist"
            autoFocus
            disabled={pending}
          />
        </Field>
      </form>
    </Modal>
  );
}
