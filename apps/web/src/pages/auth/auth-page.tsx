import { Link, useSearchParams } from "react-router-dom";
import { LogoLink } from "@/components/brand/logo";
import { StageBeams } from "@/components/brand/stage-beams";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { safeNextPath } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";
import { GoogleButton } from "./google-button";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

type Mode = "login" | "register";

const COPY: Record<Mode, { title: string; emphasis: string; lead: string; google: string }> = {
  login: {
    title: "Chào bạn",
    emphasis: "quay lại",
    lead: "Một tài khoản cho vé, merch và sàn bán lại. Vé của bạn đang đợi trong ví.",
    google: "Tiếp tục với Google",
  },
  register: {
    title: "Lấy vé",
    emphasis: "vào cửa",
    lead: "Tạo tài khoản để mua vé, giữ vé trong ví và bán lại khi không đi được.",
    google: "Đăng ký bằng Google",
  },
};

/** Lỗ khuyết hai bên + đường răng cưa: chỗ xé cuống vé (V-105). */
function Perforation() {
  return (
    <div aria-hidden="true" className="relative h-0">
      <div className="absolute inset-x-4 -top-px border-t-[3px] border-dashed border-card-foreground md:inset-x-6" />
      <div className="absolute -top-[13px] -left-[13px] size-[26px] rounded-full bg-stage md:-top-[18px] md:-left-[18px] md:size-9" />
      <div className="absolute -top-[13px] -right-[13px] size-[26px] rounded-full bg-stage md:-top-[18px] md:-right-[18px] md:size-9" />
    </div>
  );
}

function ModeTabs({ mode, nextQuery }: { mode: Mode; nextQuery: string }) {
  const tab = (target: Mode, label: string) => {
    const active = mode === target;
    return (
      <Link
        to={`/${target}${nextQuery}`}
        replace
        aria-current={active ? "page" : undefined}
        className={cn(
          "inline-flex h-11 flex-1 items-center justify-center rounded-full px-[22px] text-[15px] font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 md:h-12 md:flex-none md:text-base",
          active
            ? "bg-secondary text-secondary-foreground"
            : "border-2 border-card-foreground hover:bg-accent",
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Đăng nhập hoặc đăng ký" className="flex gap-2.5">
      {tab("login", "Đăng nhập")}
      {tab("register", "Đăng ký")}
    </nav>
  );
}

export function AuthPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const nextQuery = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  const copy = COPY[mode];

  return (
    <div className="relative min-h-screen overflow-hidden bg-stage text-stage-foreground">
      <StageBeams />
      <div className="relative mx-auto flex min-h-screen max-w-[1312px] flex-wrap content-start items-center gap-x-14 gap-y-6 px-4 pt-[18px] pb-10 md:px-8 md:pt-8 md:pb-16 xl:px-16">
        <div className="flex w-full items-center justify-between gap-4">
          <LogoLink />
          <ThemeToggle />
        </div>

        <section className="relative flex flex-[1_1_420px] flex-col gap-5 md:gap-7">
          <h1 className="m-0 mt-2 text-[54px] leading-[0.86] font-extrabold tracking-[-0.06em] md:mt-8 md:text-[clamp(88px,8.6vw,132px)] md:leading-[0.84]">
            {copy.title}
            <br />
            <span className="font-serif font-medium text-stage-emphasis italic">
              {copy.emphasis}
            </span>
          </h1>
          <p className="m-0 hidden max-w-[34ch] text-xl leading-normal md:block">{copy.lead}</p>
          <div className="relative mt-2.5 hidden h-[200px] w-[320px] -rotate-6 lg:block">
            <img
              src="/seed/banners/neon-pulse-2027.jpg"
              alt=""
              className="block h-full w-full object-cover"
            />
            <span className="absolute top-1/2 -left-3.5 -mt-3.5 size-7 rounded-full bg-stage" />
            <span className="absolute top-1/2 -right-3.5 -mt-3.5 size-7 rounded-full bg-stage" />
          </div>
        </section>

        <div className="relative w-full min-w-0 flex-[1_1_480px] md:max-w-[620px]">
          <div
            aria-hidden="true"
            className="absolute -top-10 -right-5 z-10 hidden size-[140px] rotate-[14deg] lg:block"
          >
            <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
              <polygon
                fill="#a7e8c5"
                points="50,0 59,21 80,8 75,32 99,33 81,49 99,66 75,67 80,92 59,79 50,100 41,79 20,92 25,67 1,66 19,49 1,33 25,32 20,8 41,21"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-center text-[15px] leading-[1.05] font-extrabold text-[#1c1c20]">
              Vé vào
              <br />
              cửa
            </span>
          </div>
          <div className="rotate-1 bg-card text-card-foreground outline-2 outline-card-foreground md:rotate-[1.2deg] dark:outline-0">
            <div className="flex flex-col gap-3 px-[18px] pt-5 pb-4 md:gap-[18px] md:px-9 md:pt-8 md:pb-6">
              <ModeTabs mode={mode} nextQuery={nextQuery} />
              <GoogleButton label={copy.google} next={next} />
            </div>
            <Perforation />
            <div className="flex flex-col gap-3 px-[18px] pt-[18px] pb-[22px] md:gap-[18px] md:px-9 md:pt-[26px] md:pb-9">
              <h2 className="m-0 font-serif text-lg font-medium italic">hoặc dùng email</h2>
              {mode === "login" ? <LoginForm next={next} /> : <RegisterForm next={next} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
