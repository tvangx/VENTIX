import type { RouteObject } from "react-router-dom";
import { RootLayout } from "@/components/layout/root-layout";
import { GuestOnly, RequireAuth } from "@/components/layout/route-guards";
import { AccountPage } from "@/pages/account";
import { AuthCallbackPage } from "@/pages/auth/auth-callback";
import { AuthPage } from "@/pages/auth/auth-page";
import { ComingSoonPage } from "@/pages/coming-soon";
import { HomePage } from "@/pages/home";
import { NotFoundPage } from "@/pages/not-found";

// Layout riêng Organizer/Admin làm ở task sau (V-203…). Tách khỏi router.tsx để test dùng
// createMemoryRouter với cùng cây route.
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "explore", element: <ComingSoonPage title="Khám phá" /> },
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
