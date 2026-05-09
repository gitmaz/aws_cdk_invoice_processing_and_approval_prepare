import type { Request } from "express";

/** Minimal API Gateway REST (v1) proxy shape compatible with invoice Lambdas (local / REST). */
export function expressToApiGwRest(req: Request): Record<string, unknown> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers[k] = Array.isArray(v) ? v.join(",") : String(v);
  }

  let body: string | undefined;
  if (Buffer.isBuffer(req.body)) {
    body = req.body.length ? req.body.toString("utf8") : undefined;
  } else if (typeof req.body === "string") {
    body = req.body;
  } else if (req.body !== undefined && req.body !== null) {
    body = JSON.stringify(req.body);
  }

  return {
    resource: req.path,
    path: req.path,
    httpMethod: req.method,
    headers,
    multiValueHeaders: {},
    queryStringParameters: req.query as Record<string, string>,
    pathParameters: req.params,
    body: body ?? null,
    isBase64Encoded: false,
    requestContext: {
      identity: {},
      httpMethod: req.method,
      path: req.path,
      stage: "prepare",
      requestId: "prepare-req",
      /** Used by `public-api` when present (HTTP API v2 shape). */
      http: {
        method: req.method,
        path: req.path,
      },
    },
    stageVariables: null,
  };
}
