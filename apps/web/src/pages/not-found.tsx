import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Không tìm thấy trang</h1>
      <Button asChild variant="outline">
        <Link to="/">Về trang chủ</Link>
      </Button>
    </main>
  );
}
