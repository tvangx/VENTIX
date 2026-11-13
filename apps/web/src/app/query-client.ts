import { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

// Lỗi 4xx là lỗi nghiệp vụ/quyền (401 đã do interceptor xử lý): thử lại không giúp gì.
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status !== undefined && status < 500) {
    return false;
  }
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
    },
  });
}
