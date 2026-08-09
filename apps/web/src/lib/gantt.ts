export async function loadGantt() {
  return (await import("frappe-gantt")).default;
}
