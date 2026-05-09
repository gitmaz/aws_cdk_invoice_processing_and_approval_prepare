import { applyPrepareEnv } from "./prepare-env.js";
import { registerSdkMocks, wireOrchestrator } from "./setup-mocks.js";

const PORT = Number(process.env.PORT ?? 3333);
const publicBase =
  process.env.PREPARE_PUBLIC_URL ?? `http://${process.env.PREPARE_HOST ?? "127.0.0.1"}:${PORT}`;
process.env.PREPARE_PUBLIC_URL = publicBase;

applyPrepareEnv(PORT);
registerSdkMocks();
await wireOrchestrator();

const { createApp } = await import("./app.js");
const app = createApp(publicBase);

app.listen(PORT, () => {
  console.log(`Invoice prepare monolith listening on ${publicBase}`);
  console.log(`  POST ${publicBase}/upload/presign  (header x-presign-local-secret)`);
  console.log(`  PUT  ${publicBase}/internal/s3/<bucket>/<key>  (mock S3)`);
  console.log(`  POST ${publicBase}/upload/complete`);
  console.log(`  GET  ${publicBase}/public/invoice/:id?session=…`);
  console.log(`  POST ${publicBase}/public/decision`);
});
