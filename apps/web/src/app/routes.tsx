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

// Layout riêng Organizer/Admin làm ở task sau (V-203…). Tách khỏi router.tsx để test dùng
// createMemoryRouter với cùng cây route.
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "events/:id", element: <EventDetailPage /> },
      // Chọn ghế, phòng chờ, thanh toán làm ở V-202/V-301/T-304; tạm là trang "Sắp có".
      { path: "events/:id/buy", element: <ComingSoonPage title="Mua vé" /> },
      { path: "resale", element: <ComingSoonPage title="Sàn bán lại" /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "tickets", element: <ComingSoonPage title="Vé của tôi" /> },
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
