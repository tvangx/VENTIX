/** Logger tối thiểu (pino tương thích). Mặc định không log để thư viện không tự in ra console. */
export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const noopLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Chuẩn hóa lỗi thành chuỗi ngắn, không kèm stack (an toàn để đưa vào header Kafka). */
export function errorMessage(err: unknown, maxLength = 500): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
