/* global __ENV */
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";
import { authHeaders, requireTokens } from "./lib/auth.js";

function integer(name, fallback, max) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
const users = integer("USERS", 5000, 10000);
const seats = integer("SEATS", 2000, 1000000);
const eventId = (__ENV.EVENT_ID || "").toLowerCase();
const baseUrl = (__ENV.BASE_URL || "http://localhost:3003").replace(/\/$/, "");
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(eventId)) {
  throw new Error("EVENT_ID must be a UUID for a fresh synthetic local event");
}
requireTokens(users);
const success = new Counter("s1_success");
const conflict = new Rate("s1_conflict");
const serverError = new Rate("s1_5xx");
const unexpected = new Rate("s1_unexpected");
const transportError = new Rate("s1_transport_error");

export const options = {
  scenarios: {
    contention: { executor: "per-vu-iterations", vus: users, iterations: 1, maxDuration: "5m" },
  },
  discardResponseBodies: true,
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
  systemTags: ["status", "method", "name", "scenario", "expected_response"],
  thresholds: {
    iterations: [`count==${users}`],
    checks: ["rate==1"],
    s1_success: ["count>0"],
    s1_unexpected: ["rate==0"],
    s1_5xx: ["rate==0"],
  },
};

// 409 là kết quả tranh ghế hợp lệ. Không retry, extend hoặc release trong S1.
http.setResponseCallback(http.expectedStatuses(201, 409));
export default function () {
  const number = Math.floor(Math.random() * seats) + 1;
  const seat = `20500000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const response = http.post(
    `${baseUrl}/v1/holds`,
    JSON.stringify({ event_id: eventId, seat_ids: [seat] }),
    {
      headers: authHeaders(eventId),
      timeout: "60s",
      redirects: 0,
      tags: { name: "POST /v1/holds S1" },
    },
  );
  success.add(response.status === 201 ? 1 : 0);
  conflict.add(response.status === 409);
  serverError.add(response.status >= 500 && response.status <= 599);
  unexpected.add(response.status !== 201 && response.status !== 409);
  transportError.add(response.status === 0);
  check(response, { "201 or 409": (r) => r.status === 201 || r.status === 409 });
}
