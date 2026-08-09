import type { WorkPlanStatus } from "@workplan/contracts";
import { statusLabels } from "../lib/format";

export function StatusBadge({ status }: { status: WorkPlanStatus }) {
  return <span className={`status-badge status-${status}`}><i />{statusLabels[status]}</span>;
}
