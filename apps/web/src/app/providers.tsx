import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useState, type ReactNode } from "react";

// Lỗi 4xx là lỗi nghiệp vụ/quyền (401 đã do interceptor xử lý): thử lại không giúp gì.
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status !== undefined && status < 500) {
    return false;
  }
  return failureCount < 1;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
