import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { restoreSession } from "@/lib/auth/session";
import { DARK_QUERY, useThemeStore } from "@/lib/theme/theme";
import { createQueryClient } from "./query-client";

/** Khôi phục phiên một lần khi app khởi động và theo dõi chế độ sáng/tối của hệ điều hành. */
function AppEffects() {
  const syncSystem = useThemeStore((state) => state.syncSystem);

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(() => {
    syncSystem();
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener("change", syncSystem);
    return () => media.removeEventListener("change", syncSystem);
  }, [syncSystem]);

  return null;
}

export function AppProviders({
  children,
  queryClient: injected,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const [queryClient] = useState(() => injected ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AppEffects />
      {children}
    </QueryClientProvider>
  );
}
