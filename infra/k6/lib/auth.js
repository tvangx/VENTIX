/* global __ENV, open */
import { SharedArray } from "k6/data";
import exec from "k6/execution";

const tokens = new SharedArray("S1 distinct dev JWTs", () => {
  if (!__ENV.TOKENS_FILE) throw new Error("TOKENS_FILE is required (mint-test-tokens.ts)");
  const rows = JSON.parse(open(__ENV.TOKENS_FILE));
  const subjects = new Set();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Token array is empty");
  for (const row of rows) {
    if (
      !row ||
      typeof row.sub !== "string" ||
      typeof row.token !== "string" ||
      subjects.has(row.sub)
    ) {
      throw new Error("Each VU requires a distinct JWT subject");
    }
    subjects.add(row.sub);
  }
  return rows;
});

export function requireTokens(users) {
  if (tokens.length < users) throw new Error("Not enough distinct tokens for USERS");
}

export function authHeaders(eventId) {
  const row = tokens[exec.vu.idInTest - 1];
  if (!row) throw new Error("No token for VU");
  return {
    Authorization: `Bearer ${row.token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `s1-${eventId}-${exec.vu.idInTest}`,
  };
}
