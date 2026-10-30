import Redis from "ioredis";
import { GenericContainer } from "testcontainers";

export async function startBookingRedis() {
  // Cùng tag với hạ tầng dev hiện có, không dùng Redis local của người dùng.
  const container = await new GenericContainer("redis:7.4-alpine")
    .withCommand(["redis-server", "--maxmemory-policy", "noeviction"])
    .withExposedPorts(6379)
    .start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  const redis = new Redis(url);
  await redis.ping();
  return {
    redis,
    url,
    close: async () => {
      await redis.quit();
      await container.stop();
    },
  };
}

export type BookingRedis = Awaited<ReturnType<typeof startBookingRedis>>;

export async function pollUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Redis state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
