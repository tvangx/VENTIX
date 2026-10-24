import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { describe, expect, it, vi } from "vitest";
import { installRefreshInterceptor } from "./refresh-interceptor";

const LOGIN_PATH = "/identity/v1/auth/login";
const REFRESH_PATH = "/identity/v1/auth/refresh";

/** Server giả: chỉ chấp nhận đúng access token hiện hành, sai hoặc thiếu thì 401. */
function createHarness(opts: { refreshFails?: boolean; serverAlwaysRejects?: boolean } = {}) {
  let validToken = "token-1";
  let storedToken: string | null = "expired-token";
  let refreshCount = 0;
  const seenAuth: string[] = [];

  const respond = (config: InternalAxiosRequestConfig, status: number): AxiosResponse => ({
    data: { ok: status === 200 },
    status,
    statusText: String(status),
    headers: {},
    config,
  });

  const adapter: AxiosAdapter = async (config) => {
    // Nhường event loop để các request song song thật sự chồng lên nhau.
    await new Promise((resolve) => setTimeout(resolve, 1));
    const auth = AxiosHeaders.from(config.headers).get("Authorization");
    seenAuth.push(String(auth ?? ""));
    if (!opts.serverAlwaysRejects && auth === `Bearer ${validToken}`) {
      return respond(config, 200);
    }
    const response = respond(config, 401);
    throw new AxiosError("Unauthorized", AxiosError.ERR_BAD_REQUEST, config, null, response);
  };

  const client = axios.create({ adapter });
  const refresh = vi.fn(async () => {
    refreshCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (opts.refreshFails) {
      throw new Error("refresh token revoked");
    }
    validToken = `token-${refreshCount + 1}`;
    return validToken;
  });
  const onRefreshed = vi.fn((token: string) => {
    storedToken = token;
  });
  const onAuthFailure = vi.fn(() => {
    storedToken = null;
  });

  const uninstall = installRefreshInterceptor(client, {
    getAccessToken: () => storedToken,
    refresh,
    onRefreshed,
    onAuthFailure,
    skipRefreshUrls: [LOGIN_PATH, REFRESH_PATH],
  });

  return {
    client,
    refresh,
    onRefreshed,
    onAuthFailure,
    uninstall,
    seenAuth,
    getStoredToken: () => storedToken,
  };
}

describe("installRefreshInterceptor", () => {
  it("refreshes once on 401 and retries the request with the new token", async () => {
    const h = createHarness();

    const res = await h.client.get("/events");

    expect(res.status).toBe(200);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.onRefreshed).toHaveBeenCalledWith("token-2");
    expect(h.seenAuth).toEqual(["Bearer expired-token", "Bearer token-2"]);
    expect(h.onAuthFailure).not.toHaveBeenCalled();
  });

  it("does not refresh when the token is still valid", async () => {
    const h = createHarness();
    await h.client.get("/events");
    h.refresh.mockClear();

    const res = await h.client.get("/events");

    expect(res.status).toBe(200);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("shares a single refresh across concurrent 401 responses", async () => {
    const h = createHarness();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => h.client.get(`/events/${i}`)),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.getStoredToken()).toBe("token-2");
  });

  it("uses the already-refreshed token for a stale request instead of refreshing again", async () => {
    const h = createHarness();
    await h.client.get("/events");
    expect(h.refresh).toHaveBeenCalledTimes(1);

    // Mô phỏng request rời trình duyệt trước khi refresh xong: lần gửi đầu mang token cũ.
    let firstSend = true;
    const res = await h.client.get("/orders", {
      transformRequest: [
        (data: unknown, headers) => {
          if (firstSend) {
            headers.set("Authorization", "Bearer expired-token");
            firstSend = false;
          }
          return data;
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("logs out once and rejects every pending request when refresh fails", async () => {
    const h = createHarness({ refreshFails: true });

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) => h.client.get(`/events/${i}`)),
    );

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.onAuthFailure).toHaveBeenCalledTimes(1);
    expect(h.getStoredToken()).toBeNull();
  });

  it("does not loop when the retried request is rejected again", async () => {
    const h = createHarness({ serverAlwaysRejects: true });

    await expect(h.client.get("/events")).rejects.toMatchObject({ response: { status: 401 } });

    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.seenAuth).toHaveLength(2);
  });

  it.each([LOGIN_PATH, REFRESH_PATH])("never refreshes on 401 from %s", async (path) => {
    const h = createHarness();

    await expect(h.client.post(path)).rejects.toMatchObject({ response: { status: 401 } });

    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("passes through non-401 errors untouched", async () => {
    const adapter: AxiosAdapter = async (config) => {
      const response: AxiosResponse = {
        data: null,
        status: 500,
        statusText: "500",
        headers: {},
        config,
      };
      throw new AxiosError("Server error", AxiosError.ERR_BAD_RESPONSE, config, null, response);
    };
    const client = axios.create({ adapter });
    const refresh = vi.fn(async () => "unused");
    installRefreshInterceptor(client, {
      getAccessToken: () => "token",
      refresh,
      onRefreshed: vi.fn(),
      onAuthFailure: vi.fn(),
    });

    await expect(client.get("/events")).rejects.toMatchObject({ response: { status: 500 } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops intercepting after uninstall", async () => {
    const h = createHarness();
    h.uninstall();

    await expect(h.client.get("/events")).rejects.toMatchObject({ response: { status: 401 } });

    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.seenAuth).toEqual([""]);
  });
});
