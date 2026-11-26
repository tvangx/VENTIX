// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, it, expect, vi } from "vitest";
import { OrderPage } from "./demo-flow";
import { apiClient } from "@/lib/http/client";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
function view(path: string, returned = false) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={returned ? "/payments/return" : "/orders/:orderId"}
            element={<OrderPage returned={returned} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("real payment UI decisions", () => {
  it("never treats a successful provider query string as confirmation", async () => {
    sessionStorage.setItem("ventix:last-order", "order1");
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({
      data: {
        order_id: "order1",
        status: "AWAITING_PAYMENT",
        total_amount_vnd: 350000,
        expires_at: "2026-12-01T00:00:00Z",
      },
    });
    const post = vi.spyOn(apiClient, "post");
    view("/payments/return?vnp_ResponseCode=00&vnp_TransactionStatus=00", true);
    await screen.findByText("Trạng thái: AWAITING_PAYMENT");
    expect(get).toHaveBeenCalledWith("/booking/v1/orders/order1");
    expect(screen.queryByText("Xem vé đã phát hành")).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it("uses VNPAY and retains the same idempotency key when retrying failed link creation", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({
      data: {
        order_id: "order1",
        status: "AWAITING_PAYMENT",
        total_amount_vnd: 350000,
        expires_at: "2026-12-01T00:00:00Z",
      },
    });
    const post = vi.spyOn(apiClient, "post").mockRejectedValue(new Error("offline"));
    view("/orders/order1");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Thanh toán VNPay sandbox" });
    await user.click(button);
    await screen.findByRole("alert");
    await user.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0][1]).toEqual({ order_id: "order1", provider: "VNPAY" });
    expect(post.mock.calls[0][2]).toEqual(post.mock.calls[1][2]);
  });
});
