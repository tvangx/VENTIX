import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppProviders } from "@/app/providers";
import { router } from "@/app/router";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

// Mock chỉ có ở dev và khi bật VITE_API_MOCKING; Vite thay hằng lúc build nên bản production
// không chứa mã MSW. Worker phải sẵn sàng trước khi render để request đầu tiên đã bị chặn.
async function enableMocking(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_API_MOCKING === "true") {
    const { startMockWorker } = await import("@/mocks/browser");
    await startMockWorker();
  }
}

void enableMocking().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
});
