/// <reference types="vite/client" />

declare module "frappe-gantt" {
  export type GanttTask = {
    id: string;
    name: string;
    start: string | Date;
    end: string | Date;
    progress: number;
    dependencies?: string;
    custom_class?: string;
  };

  export default class Gantt {
    constructor(element: HTMLElement, tasks: GanttTask[], options?: Record<string, unknown>);
    change_view_mode(mode: string, maintainPos?: boolean): void;
    refresh(tasks: GanttTask[]): void;
  }
}
