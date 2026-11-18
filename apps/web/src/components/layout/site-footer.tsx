import { Link } from "react-router-dom";
import { Wordmark } from "@/components/brand/logo";
import { StageBeams } from "@/components/brand/stage-beams";
import { MAIN_NAV } from "./nav";

// Footer đổi theo theme (V-105 "Theme sáng/tối"): logo cỡ lớn màu than trên nền sáng hoặc sáng trên than,
// chùm đèn xanh lá nhạt chiếu vào logo.
export function SiteFooter() {
  const year = new Date().getUTCFullYear();
  return (
    <footer className="relative overflow-hidden border-t-2 border-stage-rule bg-stage text-stage-foreground dark:border-t">
      <StageBeams />
      <div className="relative mx-auto max-w-[1312px] px-4 pt-16 md:px-8 md:pt-28 xl:px-16">
        <div className="flex flex-wrap items-end gap-x-16 gap-y-8">
          <p className="m-0 flex-[1_1_320px] font-serif text-3xl leading-[1.1] text-stage-emphasis italic md:text-[44px]">
            Hẹn gặp ở hàng ghế đầu.
          </p>
          <nav aria-label="Chân trang" className="flex-[1_1_240px] text-base leading-loose">
            <b>Khách hàng</b>
            <ul className="m-0 list-none p-0">
              {MAIN_NAV.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="rounded-sm hover:text-stage-emphasis focus-visible:ring-[3px] focus-visible:ring-stage-emphasis/70 focus-visible:outline-none"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div
          aria-hidden="true"
          className="mt-12 -mb-[0.12em] -ml-[0.04em] text-[clamp(96px,25vw,380px)] leading-[0.78] md:mt-20"
        >
          <Wordmark className="tracking-[-0.065em]" />
        </div>
      </div>
      <div className="relative bg-stage-foreground text-stage">
        <div className="mx-auto flex max-w-[1312px] justify-between gap-4 px-4 py-4 text-sm md:px-8 xl:px-16">
          <span>© {year} VENTIX</span>
          <a href="#top" className="underline-offset-4 hover:underline">
            Lên đầu trang
          </a>
        </div>
      </div>
    </footer>
  );
}
