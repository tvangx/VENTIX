import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "@/pages/home";
import { NotFoundPage } from "@/pages/not-found";

// Đăng nhập, chọn sự kiện/cổng và màn hình quét làm ở V-401.
export const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "*", element: <NotFoundPage /> },
]);
