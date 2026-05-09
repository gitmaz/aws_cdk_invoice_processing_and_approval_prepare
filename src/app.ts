import express from "express";

import * as presignNs from "../../aws_cdk_invoice_processing_and_approval/lambda/presign-upload/index.js";
import * as publicApiNs from "../../aws_cdk_invoice_processing_and_approval/lambda/public-api/index.js";
import * as uploadCompleteNs from "../../aws_cdk_invoice_processing_and_approval/lambda/upload-complete/index.js";

const presignHandler = presignNs.handler;
const publicApiHandler = publicApiNs.handler;
const uploadCompleteHandler = uploadCompleteNs.handler;

import { expressToApiGwRest } from "./api-gateway.js";
import * as memory from "./memory-store.js";

export function createApp(publicBaseUrl: string): express.Express {
  const app = express();

  app.use((req, _res, next) => {
    console.log(`[prepare] ${req.method} ${req.path}`);
    next();
  });

  /** Simulated S3: PUT stores bytes; GET returns object for Textract/validate path. */
  app.put(
    /^\/internal\/s3\/([^/]+)\/(.+)$/,
    express.raw({ type: "*/*", limit: "50mb" }),
    (req, res) => {
      const m = req.path.match(/^\/internal\/s3\/([^/]+)\/(.+)$/);
      if (!m) {
        res.status(400).end();
        return;
      }
      const bucket = decodeURIComponent(m[1]);
      const key = decodeURIComponent(m[2]);
      memory.s3Put(bucket, key, Buffer.from(req.body as Buffer));
      res.status(200).setHeader("ETag", '"prepare"').end();
    },
  );

  app.get(/^\/internal\/s3\/([^/]+)\/(.+)$/, (req, res) => {
    const m = req.path.match(/^\/internal\/s3\/([^/]+)\/(.+)$/);
    if (!m) {
      res.status(400).end();
      return;
    }
    const bucket = decodeURIComponent(m[1]);
    const key = decodeURIComponent(m[2]);
    const buf = memory.s3Get(bucket, key);
    if (!buf) {
      res.status(404).json({ error: "NoSuchKey" });
      return;
    }
    res.status(200).type("application/octet-stream").send(buf);
  });

  app.use(express.json({ limit: "10mb" }));

  app.post("/upload/presign", async (req, res) => {
    const evt = expressToApiGwRest(req) as any;
    const out = (await presignHandler(evt)) as { statusCode?: number; body?: string };
    const status = out.statusCode ?? 500;
    const body = JSON.parse(String(out.body ?? "{}"));

    if (status === 200 && body.bucket && body.objectKey) {
      const b = body.bucket as string;
      const k = body.objectKey as string;
      const edge = `${publicBaseUrl}/internal/s3/${encodeURIComponent(b)}/${encodeURIComponent(k)}`;
      body.uploadUrl = edge;
      body.headUrl = edge;
    }

    res.status(status).setHeader("content-type", "application/json").send(JSON.stringify(body));
  });

  app.post("/upload/complete", async (req, res) => {
    const evt = expressToApiGwRest(req) as any;
    const out = (await uploadCompleteHandler(evt)) as { statusCode?: number; body?: string };
    res.status(out.statusCode ?? 500).setHeader("content-type", "application/json").send(out.body ?? "{}");
  });

  app.get("/public/invoice/:invoiceId", async (req, res) => {
    const evt = expressToApiGwRest(req) as any;
    evt.pathParameters = { invoiceId: req.params.invoiceId };
    evt.queryStringParameters = req.query as Record<string, string>;
    const out = (await publicApiHandler(evt)) as { statusCode?: number; body?: string };
    res.status(out.statusCode ?? 500).setHeader("content-type", "application/json").send(out.body ?? "{}");
  });

  app.post("/public/decision", async (req, res) => {
    const evt = expressToApiGwRest(req) as any;
    const out = (await publicApiHandler(evt)) as { statusCode?: number; body?: string };
    res.status(out.statusCode ?? 500).setHeader("content-type", "application/json").send(out.body ?? "{}");
  });

  app.get("/health", (_req, res) => res.json({ ok: true, mode: "invoice-prepare-monolith" }));

  return app;
}
