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
