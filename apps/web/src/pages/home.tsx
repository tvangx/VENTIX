import { Link } from "react-router-dom";
import { StageBeams } from "@/components/brand/stage-beams";
import { Button } from "@/components/ui/button";

// Trang chủ tạm: khối mở màn theo V-105. Danh sách sự kiện làm ở V-201.
export function HomePage() {
  return (
    <section className="relative overflow-hidden bg-stage text-stage-foreground">
      <StageBeams />
      <div className="relative mx-auto flex max-w-[1312px] flex-col gap-6 px-4 pt-10 pb-16 md:px-8 md:pt-16 md:pb-24 xl:px-16">
        <h1 className="m-0 text-[64px] leading-[0.86] font-extrabold tracking-[-0.055em] md:text-[clamp(96px,10vw,160px)]">
          Đêm nay
          <br />
          <span className="font-serif font-medium text-stage-emphasis italic">đi đâu?</span>
        </h1>
        <p className="m-0 max-w-[46ch] text-lg leading-normal md:text-xl">
          Vé sự kiện, merchandise và sàn bán lại có kiểm soát giá, trong một tài khoản.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/explore">Khám phá sự kiện</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="hover:bg-stage-foreground/15">
            <Link to="/resale">Sàn bán lại</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
