import { useEffect, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { eventApi } from "@/lib/api";
import { toCatalogQuery, type ExploreFilters } from "./filters";

export const catalogKeys = {
  list: (filters: ExploreFilters) => ["catalog", "list", filters] as const,
  detail: (id: string) => ["catalog", "detail", id] as const,
};

/**
 * Danh sách theo cursor của GET /v1/events. Mốc "hôm nay/cuối tuần/tháng này" tính một lần khi
 * bộ lọc đổi để các trang sau dùng cùng khoảng thời gian với trang đầu.
 */
export function useCatalogList(filters: ExploreFilters) {
  return useInfiniteQuery({
    queryKey: catalogKeys.list(filters),
    queryFn: async ({ pageParam, signal }) => {
      // Trang đầu chốt mốc thời gian; trang sau dùng lại mốc này.
      const now = pageParam?.now ?? Date.now();
      const query = toCatalogQuery(filters, now);
      const page = await eventApi.get("/v1/events", {
        query: pageParam ? { ...query, cursor: pageParam.cursor } : query,
        signal,
      });
      return { ...page, now };
    },
    initialPageParam: null as { cursor: string; now: number } | null,
    getNextPageParam: (lastPage) =>
      lastPage.next_cursor ? { cursor: lastPage.next_cursor, now: lastPage.now } : undefined,
    // Đổi bộ lọc vẫn giữ kết quả cũ trên màn hình tới khi có kết quả mới, tránh nháy trang trống.
    placeholderData: keepPreviousData,
  });
}

export function useEventDetail(id: string) {
  return useQuery({
    queryKey: catalogKeys.detail(id),
    queryFn: ({ signal }) => eventApi.get("/v1/events/{id}", { path: { id }, signal }),
  });
}

/** Thời điểm hiện tại, cập nhật theo chu kỳ (đếm ngược, tình trạng mở bán). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
