import { ArchiveIcon, PlayIcon, ProhibitIcon, TrashIcon, type Icon } from "@phosphor-icons/react";
import type { TaskAction } from "../../lib/api";

export const ACTION_ICONS: Record<TaskAction, Icon> = {
  run: PlayIcon,
  archive: ArchiveIcon,
  delete: TrashIcon,
  cancel: ProhibitIcon,
};
