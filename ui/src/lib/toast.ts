import { createKumoToastManager } from "@cloudflare/kumo";
import { ApiError } from "./api";

/** Toast manager shared by the whole app, usable outside React components. */
export const toastManager = createKumoToastManager();

export function notifySuccess(title: string, description?: string) {
  toastManager.add({ title, description, variant: "success", timeout: 4000 });
}

export function notifyError(title: string, error: unknown) {
  const description = error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong.";
  toastManager.add({ title, description, variant: "error", timeout: 8000 });
}
