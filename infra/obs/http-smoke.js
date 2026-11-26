import http from "k6/http";
import { check, sleep } from "k6";

// Only target the isolated local smoke bootstraps; never use the EC2 public URL here.
export const options = {
  vus: 1,
  duration: "15s",
  thresholds: { checks: ["rate==1"] },
};
export default function () {
  for (let port = 13301; port <= 13305; port++) {
    const live = http.get(`http://127.0.0.1:${port}/health/live`);
    check(live, { "live returns 200": (response) => response.status === 200 });
    const guarded = http.get(`http://127.0.0.1:${port}/v1/whoami`);
    check(guarded, { "missing token returns 401": (response) => response.status === 401 });
  }
  sleep(1);
}
