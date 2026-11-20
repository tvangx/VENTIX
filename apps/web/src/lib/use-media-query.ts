import { useEffect, useState } from "react";

function matches(query: string): boolean {
  // Môi trường không có matchMedia (test jsdom, SSR): coi như màn rộng.
  return typeof window.matchMedia === "function" ? window.matchMedia(query).matches : true;
}

/** Theo dõi một media query CSS. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setValue(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return value;
}
