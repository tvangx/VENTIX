import { useId, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { StageBeams } from "@/components/brand/stage-beams";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilters,
  MAX_QUERY_LENGTH,
  parseFilters,
  SORTS,
  type ExploreFilters,
  type ExploreSort,
} from "@/lib/catalog/filters";
import { useCatalogList } from "@/lib/catalog/queries";
import { EventListRow, EventTicketCard } from "./event-card";
import { FilterBar } from "./filter-bar";

type View = "grid" | "list";

/** Trang Khám phá (V-105 `Explore-D`/`Explore-M`): tìm kiếm, lọc, sắp xếp, tải thêm theo cursor. */
export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);
  const [view, setView] = useState<View>("grid");
  // Màn hẹp luôn là danh sách như wireframe Explore-M.
  const wide = useMediaQuery("(min-width: 768px)");
  const shownView: View = wide ? view : "list";
  const list = useCatalogList(filters);

  const update = (next: Partial<ExploreFilters>) => {
    setSearchParams(filtersToSearch({ ...filters, ...next }), { replace: true });
  };

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const loading = list.isPending;
  const failed = list.isError && items.length === 0;

  return (
    <>
      <section className="relative overflow-hidden bg-stage text-stage-foreground">
        <StageBeams />
        <div className="relative mx-auto flex max-w-[1312px] flex-col gap-6 px-4 pt-8 pb-12 md:flex-row md:items-end md:justify-between md:px-8 md:pt-14 md:pb-16 xl:px-16">
          <h1 className="m-0 text-[56px] leading-[0.86] font-extrabold tracking-[-0.055em] md:text-[120px]">
            Khám phá
            <br />
            <span className="font-serif text-[28px] font-medium tracking-[-0.02em] text-stage-emphasis italic md:text-[44px]">
              những đêm đang chờ bạn
            </span>
          </h1>
          <SearchForm key={filters.q} initial={filters.q} onSubmit={(q) => update({ q })} />
        </div>
      </section>

      <div className="mx-auto flex max-w-[1312px] flex-col gap-8 px-4 py-8 md:px-8 md:py-12 xl:px-16">
        <FilterBar
          filters={filters}
          onChange={update}
          onReset={() => setSearchParams(filtersToSearch(DEFAULT_FILTERS), { replace: true })}
        />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <p role="status" className="m-0">
            {loading ? (
              <span className="text-lg">Đang tìm…</span>
            ) : failed ? null : (
              <>
                <b className="text-[40px] font-extrabold tracking-[-0.05em] md:text-[56px]">
                  {items.length}
                  {list.hasNextPage ? "+" : ""}
                </b>{" "}
                <span className="font-serif text-xl italic md:text-2xl">
                  {filters.q ? `đêm khớp “${filters.q}”` : "đêm khớp bộ lọc"}
                </span>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <SortSelect value={filters.sort} onChange={(sort) => update({ sort })} />
            <div
              role="group"
              aria-label="Kiểu xem"
              className="hidden rounded-full border-2 border-foreground p-1 md:flex"
            >
              {(["grid", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={cn(
                    "h-9 cursor-pointer rounded-full px-4 text-sm font-bold outline-none focus-visible:ring-4 focus-visible:ring-ring",
                    view === mode && "bg-secondary text-secondary-foreground",
                  )}
                >
                  {mode === "grid" ? "Lưới" : "Danh sách"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {failed ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-4 bg-card p-6 text-card-foreground"
          >
            <p className="m-0 text-lg font-bold">Lỗi: chưa tải được danh sách sự kiện.</p>
            <Button type="button" variant="secondary" onClick={() => void list.refetch()}>
              Thử lại
            </Button>
          </div>
        ) : null}

        {!loading && !failed && items.length === 0 ? (
          <div className="flex flex-col items-start gap-4 bg-card p-6 text-card-foreground md:p-10">
            <p className="m-0 text-2xl font-extrabold tracking-[-0.03em]">
              Chưa có đêm nào khớp{" "}
              <span className="font-serif font-medium text-emphasis italic">bộ lọc này</span>
            </p>
            <p className="m-0">Thử bỏ bớt bộ lọc hoặc tìm bằng từ khóa khác.</p>
            {hasActiveFilters(filters) ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSearchParams(filtersToSearch(DEFAULT_FILTERS), { replace: true })}
              >
                Xóa bộ lọc
              </Button>
            ) : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <div
            data-testid="catalog-results"
            aria-busy={list.isFetching}
            className={
              shownView === "grid"
                ? "grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "flex flex-col gap-3"
            }
          >
            {items.map((card, index) =>
              shownView === "grid" ? (
                <EventTicketCard key={card.id} card={card} index={index} />
              ) : (
                <EventListRow key={card.id} card={card} />
              ),
            )}
          </div>
        ) : null}

        {list.hasNextPage ? (
          <div className="flex flex-col items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? "Đang tải…" : "Xem thêm"}
            </Button>
            {list.isFetchNextPageError ? (
              <p role="alert" className="m-0 font-bold">
                Lỗi: chưa tải được trang tiếp theo. Bấm “Xem thêm” để thử lại.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function SearchForm({ initial, onSubmit }: { initial: string; onSubmit: (q: string) => void }) {
  const [value, setValue] = useState(initial);
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value.trim());
  };
  return (
    <form
      role="search"
      onSubmit={submit}
      className="flex w-full items-center rounded-full bg-card p-1 text-card-foreground md:max-w-[520px] dark:bg-background"
    >
      <label htmlFor={id} className="sr-only">
        Tìm theo tên sự kiện hoặc địa điểm
      </label>
      <Search aria-hidden="true" className="ml-4 size-5 shrink-0" />
      <input
        id={id}
        type="search"
        value={value}
        maxLength={MAX_QUERY_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Tên sự kiện, địa điểm"
        className="h-12 min-w-0 flex-1 border-0 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground md:h-14 md:text-lg"
      />
      <Button type="submit" className="md:h-14 md:px-7">
        Tìm
      </Button>
    </form>
  );
}

function SortSelect({
  value,
  onChange,
}: {
  value: ExploreSort;
  onChange: (sort: ExploreSort) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[15px] font-semibold">
        Sắp xếp
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as ExploreSort)}
        className="h-11 cursor-pointer rounded-full border-2 border-foreground bg-background px-4 text-[15px] font-semibold text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring"
      >
        {(Object.keys(SORTS) as ExploreSort[]).map((sort) => (
          <option key={sort} value={sort}>
            {SORTS[sort]}
          </option>
        ))}
      </select>
    </div>
  );
}
