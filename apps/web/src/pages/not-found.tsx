import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-[1312px] flex-col items-start gap-5 px-4 py-16 md:px-8 md:py-24 xl:px-16">
      <h1 className="m-0 text-5xl leading-[0.9] font-extrabold tracking-[-0.04em] md:text-7xl">
        Không tìm thấy
        <br />
        <span className="font-serif font-medium text-emphasis italic">trang này</span>
      </h1>
      <Button asChild variant="secondary">
        <Link to="/">Về trang chủ</Link>
      </Button>
    </section>
  );
}
