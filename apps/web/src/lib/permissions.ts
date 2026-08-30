import type { UserRole } from "@workplan/contracts";

// 镜像服务端路由能力矩阵：Administrator 与 Editor 具备业务写入能力，Viewer 只读。
// 前端限制仅用于体验，服务端授权仍是最终安全边界。
export function canWriteBusinessData(role: UserRole): boolean {
  return role === "admin" || role === "editor";
}

export function roleLabel(role: UserRole): string {
  return role === "admin" ? "管理员" : role === "editor" ? "编辑者" : "只读账户";
}
