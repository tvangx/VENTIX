import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vitest";
import type { paths as BookingPaths } from "./generated/booking";
import type { paths as FinancePaths } from "./generated/finance";
import { buildPath } from "./openapi-types";
import { toProblem } from "./problem";
import { createServiceClient } from "./typed-client";

/** Axios có adapter giả: ghi lại config và trả status/body cho trước, không đi mạng. */
function fakeHttp(status: number, data: unknown) {
  const calls: InternalAxiosRequestConfig[] = [];
  const http = axios.create({
    baseURL: "/api",
    adapter: async (config) => {
      calls.push(config);
      return { data, status, statusText: "", headers: {}, config };
    },
  });
  return { http, calls };
}

describe("buildPath", () => {
  it("thay tham số và mã hóa ký tự đặc biệt", () => {
    expect(buildPath("/v1/events/{id}/stats", { id: "a b/c" })).toBe("/v1/events/a%20b%2Fc/stats");
  });

  it("thiếu tham số thì ném lỗi thay vì gọi URL sai", () => {
    expect(() => buildPath("/v1/events/{id}", {})).toThrow(/Missing path parameter "id"/);
  });
});

describe("createServiceClient", () => {
  it("ghép prefix service + path, gửi query/body/header đúng chỗ", async () => {
    const { http, calls } = fakeHttp(201, { expires_at: "2026-11-12T00:00:00Z", seat_ids: ["s1"] });
    const booking = createServiceClient<BookingPaths>(http, "/booking");
    const result = await booking.post("/v1/holds", {
      body: { event_id: "e1", seat_ids: ["s1"] },
      headers: { "X-Admission-Token": "adm" },
    });
    expect(result.seat_ids).toEqual(["s1"]);
    expect(calls[0]).toMatchObject({ method: "post", url: "/booking/v1/holds" });
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ event_id: "e1", seat_ids: ["s1"] });
    expect(calls[0]?.headers.get("X-Admission-Token")).toBe("adm");

    await createServiceClient<FinancePaths>(http, "/finance").get("/v1/admin/audit", {
      query: { limit: "10", action: "X" },
    });
    expect(calls[1]).toMatchObject({
      url: "/finance/v1/admin/audit",
      params: { limit: "10", action: "X" },
    });
  });

  it("204 trả undefined", async () => {
    const { http } = fakeHttp(204, "");
    const booking = createServiceClient<BookingPaths>(http, "/booking");
    await expect(
      booking.delete("/v1/holds", { body: { event_id: "e1" } }),
    ).resolves.toBeUndefined();
  });
});

describe("toProblem", () => {
  const axiosError = (data: unknown) =>
    new AxiosError("x", "ERR_BAD_REQUEST", undefined, undefined, {
      data,
      status: 409,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
    });

  it("đọc problem+json, giữ trường mở rộng", () => {
    const problem = toProblem(
      axiosError({
        type: "urn:ticketing:problem:seat_unavailable",
        title: "Conflict",
        status: 409,
        detail: "x",
        code: "SEAT_UNAVAILABLE",
        request_id: null,
        seat_id: "s1",
      }),
    );
    expect(problem).toMatchObject({ code: "SEAT_UNAVAILABLE", seat_id: "s1" });
  });

  it("body không đúng dạng hoặc không phải lỗi axios → null", () => {
    expect(toProblem(axiosError("<html>"))).toBeNull();
    expect(toProblem(new Error("network"))).toBeNull();
  });
});
