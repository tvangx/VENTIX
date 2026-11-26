import { cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { AppProviders } from "@/app/providers";
import { createQueryClient } from "@/app/query-client";
import { routes } from "@/app/routes";
import { useAuthStore } from "@/lib/http/auth-store";
import { useTenantStore } from "@/lib/organizer/tenant";
import { resetMockState } from "@/mocks/db";
import { mockServer } from "@/mocks/node";

/**
 * Dựng cả app (cùng cây route, provider, interceptor) trên router trong bộ nhớ;
 * API đi qua MSW node với đúng handler của V-103.
 */
export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, queryClient, ...view };
}

/** Đăng ký vòng đời MSW + dọn trạng thái giữa các test; gọi một lần ở đầu file spec. */
export function setupAppHarness(): void {
  beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
  beforeEach(() => {
    resetMockState();
    useAuthStore.setState({ accessToken: null, status: "unknown" });
    useTenantStore.setState({ organizerId: null, token: null, epoch: 0 });
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    mockServer.resetHandlers();
    mockServer.events.removeAllListeners();
  });
  afterAll(() => mockServer.close());
}
