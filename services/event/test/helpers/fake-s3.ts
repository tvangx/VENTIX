import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * S3 giả tối thiểu (path-style) cho test không cần Docker: PUT, HEAD, GET có Range, DELETE.
 * Không kiểm chữ ký; test kiểm chữ ký bằng cách đọc query của URL presign.
 */
export async function startFakeS3() {
  const objects = new Map<string, StoredObject>();
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    requests.push(`${req.method} ${path}`);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const object = objects.get(path);
      if (req.method === "PUT") {
        objects.set(path, {
          body: Buffer.concat(chunks),
          contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
        });
        res.writeHead(200, { ETag: '"fake"' }).end();
      } else if (req.method === "DELETE") {
        objects.delete(path);
        res.writeHead(204).end();
      } else if (!object) {
        res.writeHead(404, { "Content-Type": "application/xml" });
        res.end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>");
      } else if (req.method === "HEAD") {
        res
          .writeHead(200, {
            "Content-Length": object.body.length,
            "Content-Type": object.contentType,
          })
          .end();
      } else if (req.method === "GET") {
        const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ""));
        const slice = range
          ? object.body.subarray(Number(range[1]), Number(range[2]) + 1)
          : object.body;
        res
          .writeHead(range ? 206 : 200, {
            "Content-Length": slice.length,
            "Content-Type": object.contentType,
            ...(range && {
              "Content-Range": `bytes ${range[1]}-${Number(range[1]) + slice.length - 1}/${object.body.length}`,
            }),
          })
          .end(slice);
      } else {
        res.writeHead(405).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    endpoint,
    objects,
    requests,
    /** Đặt object trực tiếp, bỏ qua URL presign. */
    put(bucket: string, key: string, body: Buffer, contentType: string) {
      objects.set(`/${bucket}/${key}`, { body, contentType });
    },
    has(bucket: string, key: string) {
      return objects.has(`/${bucket}/${key}`);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeS3 = Awaited<ReturnType<typeof startFakeS3>>;

export const PNG_BYTES = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("fake-png-body"),
]);
export const JPEG_BYTES = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from("jpeg")]);
export const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
]);
