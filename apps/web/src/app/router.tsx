import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "@/pages/home";
import { NotFoundPage } from "@/pages/not-found";

// Trang đăng nhập/đăng ký và layout theo vai trò làm ở V-102.
export const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "*", element: <NotFoundPage /> },
]);
