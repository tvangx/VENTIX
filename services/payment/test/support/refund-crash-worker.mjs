// Chỉ dùng trong test: transpile source hiện tại, không cần build trước.
import fs from "node:fs";
import process from "node:process";
import { createRequire } from "node:module";
import ts from "typescript";
const load = createRequire(import.meta.url);
load.extensions[".ts"] = (mod, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
    },
  });
  mod._compile(output.outputText, filename);
};
load("reflect-metadata");
const { createApp } = load("../../src/bootstrap.ts");
const { envSchema } = load("../../src/config/env.schema.ts");
const { RefundRepository } = load("../../src/modules/refunds/refund.repository.ts");
const { RefundWorker } = load("../../src/modules/refunds/refund-worker.ts");
const { PaymentService } = load("../../src/modules/payments/payment.service.ts");
const { createLogger } = load("@ticketing/common");
process.on("message", async (raw) => {
  try {
    const app = await createApp(
      envSchema.parse(raw),
      createLogger("refund-crash-test", { level: "silent" }),
    );
    await app.init();
    const repo = app.get(RefundRepository),
      worker = app.get(RefundWorker),
      payment = app.get(PaymentService);
    for (let i = 0; i < 20; i++) {
      const row = await repo.claim();
      if (!row) throw new Error("Expected claim");
      await worker.process(row);
    }
    const row = await repo.claim();
    if (!row) throw new Error("Expected crash claim");
    await payment.mock.refund(repo.input(row));
    process.send({ claimed: row.id }); // Process cha kill worker trước khi ghi kết quả.
  } catch (error) {
    process.send({ error: String(error) });
    process.exitCode = 1;
  }
});
