export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export const notFound = (message = "资源不存在") => new AppError(404, "NOT_FOUND", message);
export const versionConflict = () => new AppError(409, "VERSION_CONFLICT", "数据已被修改，请刷新后重试");
export const invalidInput = (message: string, errors?: Record<string, string[]>) =>
  new AppError(422, "VALIDATION_ERROR", message, errors);
// 统一查询稳定错误类别：游标错误固定 400，排序字段错误为参数错误（422）并携带专用 code。
export const cursorInvalid = (message = "游标无效或版本不受支持") => new AppError(400, "CURSOR_INVALID", message);
export const cursorMismatch = (message = "游标与当前查询条件不匹配") => new AppError(400, "CURSOR_MISMATCH", message);
export const sortFieldError = (code: "SORT_FIELD_INVALID" | "SORT_FIELD_DUPLICATED" | "SORT_FIELD_UNSUPPORTED", message: string) =>
  new AppError(422, code, message);
// 工作计划人工重排已退役：无副作用墓碑（票据 14），code 供 14 天零调用观察统计。
export const reorderRetired = () => new AppError(410, "WORK_PLAN_REORDER_RETIRED", "工作计划人工排序已退役，请使用查询排序与筛选");
