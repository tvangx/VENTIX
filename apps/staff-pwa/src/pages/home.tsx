import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <ScanLine className="size-12" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">Staff Check-in</h1>
      <p className="text-muted-foreground">Quét vé tại cổng, hoạt động cả khi mất mạng.</p>
      <Button size="lg" className="w-full" disabled>
        Bắt đầu quét
      </Button>
    </main>
  );
}
