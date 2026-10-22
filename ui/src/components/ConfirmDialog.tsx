import { useEffect, useState, type ReactNode } from "react";
import { Button, Dialog, Input } from "@cloudflare/kumo";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  /** Destructive actions use a red confirm button. */
  destructive?: boolean;
  /** When set, the user must type this text to enable the confirm button. */
  confirmText?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<unknown>;
}

/**
 * Confirmation dialog for actions that affect many tasks or cannot be undone.
 * The dialog stays open while the action runs and closes once it settles.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  confirmText,
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const busy = loading || running;
  const canConfirm = !busy && (!confirmText || typed.trim() === confirmText);

  const handleConfirm = async () => {
    setRunning(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Errors are reported by the mutation (toast); keep the dialog open to allow a retry.
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog.Root role="alertdialog" open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog size="base" className="flex flex-col gap-4 p-6">
        <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
        <Dialog.Description className="text-sm text-kumo-subtle">{description}</Dialog.Description>
        {confirmText && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canConfirm) handleConfirm();
            }}
          >
            <Input
              label={
                <span>
                  Type <strong className="font-mono">{confirmText}</strong> to confirm
                </span>
              }
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </form>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={handleConfirm}
            disabled={!canConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
