import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-6 text-center">
      <Ticket className="size-12" aria-hidden />
      <h1 className="text-3xl font-semibold tracking-tight">Ticketing Platform</h1>
      <p className="text-muted-foreground">Vé sự kiện, merchandise và sàn resale.</p>
      <Button disabled>Khám phá sự kiện</Button>
    </main>
  );
}
