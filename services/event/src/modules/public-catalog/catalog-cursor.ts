import { ProblemException } from "@ticketing/common";
import { isISO8601, isUUID } from "class-validator";
import type { CatalogQuery } from "./public-catalog.dto";

export type CatalogCursor =
  | { sort: "id"; id: string }
  | { sort: "start_at"; id: string; startsAt: string }
  | { sort: "price_asc"; id: string; price: bigint | null };

export function readCatalogCursor(query: CatalogQuery): CatalogCursor | undefined {
  if (query.cursor === undefined) return;
  const sort = query.sort ?? "id";
  if (sort === "id" && isUUID(query.cursor)) return { sort, id: query.cursor };

  const [tokenSort, id, value, ...rest] = query.cursor.split("|");
  if (sort === tokenSort && isUUID(id) && value !== undefined && rest.length === 0) {
    if (
      sort === "start_at" &&
      /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) &&
      isISO8601(value, { strict: true, strictSeparator: true })
    ) {
      return { sort, id, startsAt: value };
    }
    if (sort === "price_asc") {
      if (value === "-") return { sort, id, price: null };
      if (/^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)))
        return { sort, id, price: BigInt(value) };
    }
  }
  throw new ProblemException("INVALID_CATALOG_CURSOR", 400, "Cursor không hợp lệ cho kiểu sắp xếp");
}
