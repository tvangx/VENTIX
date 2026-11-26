import type { RouteObject } from "react-router-dom";
import { RootLayout } from "@/components/layout/root-layout";
import { GuestOnly, RequireAuth } from "@/components/layout/route-guards";
import { AccountPage } from "@/pages/account";
import { AuthCallbackPage } from "@/pages/auth/auth-callback";
import { AuthPage } from "@/pages/auth/auth-page";
import { ComingSoonPage } from "@/pages/coming-soon";
import { EventDetailPage } from "@/pages/event/event-detail-page";
import { ExplorePage } from "@/pages/explore/explore-page";
import { HomePage } from "@/pages/home";
import { NotFoundPage } from "@/pages/not-found";
import { BuyPage, OrderPage, TicketsPage } from "@/pages/booking/demo-flow";

// Layout riêng Organizer/Admin làm ở task sau (V-203…). Tách khỏi router.tsx để test dùng
// createMemoryRouter với cùng cây route.
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "events/:id", element: <EventDetailPage /> },
      // Trang ghế tải lười để Konva không vào bundle chính.
      {
        path: "events/:id/seats",
        lazy: async () => ({
          Component: (await import("@/pages/seats/seat-selection-page")).SeatSelectionPage,
        }),
      },
      // Phòng chờ, mua vé đứng, thanh toán làm ở V-301/T-304; tạm là trang "Sắp có".
      { path: "resale", element: <ComingSoonPage title="Sàn bán lại" /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "events/:id/buy", element: <BuyPage /> },
          { path: "orders/:orderId", element: <OrderPage /> },
          { path: "payments/return", element: <OrderPage returned /> },
          { path: "tickets", element: <TicketsPage /> },
          { path: "account", element: <AccountPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    element: <GuestOnly />,
    children: [
      { path: "login", element: <AuthPage mode="login" /> },
      { path: "register", element: <AuthPage mode="register" /> },
    ],
  },
  { path: "auth/callback", element: <AuthCallbackPage /> },
];
