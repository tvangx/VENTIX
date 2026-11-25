import { Navigate, type RouteObject } from "react-router-dom";
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

// Tách khỏi router.tsx để test dùng createMemoryRouter với cùng cây route.
// Khu ban tổ chức (V-203) có layout riêng ("hậu trường"), tải lười: chỉ organizer mới cần.
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
  {
    element: <RequireAuth />,
    children: [
      {
        path: "organizer",
        lazy: async () => ({
          Component: (await import("@/pages/organizer/organizer-layout")).OrganizerLayout,
        }),
        children: [
          { index: true, element: <Navigate to="events" replace /> },
          {
            path: "events",
            lazy: async () => ({
              Component: (await import("@/pages/organizer/events-page")).OrganizerEventsPage,
            }),
          },
          // Wizard tải lười riêng vì có Konva (xem trước sơ đồ ghế).
          { path: "events/new", lazy: wizard },
          { path: "events/:id", lazy: wizard },
        ],
      },
    ],
  },
];

async function wizard() {
  return {
    Component: (await import("@/pages/organizer/wizard/wizard-page")).OrganizerWizardPage,
  };
}
