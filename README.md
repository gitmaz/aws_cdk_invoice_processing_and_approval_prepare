# aws_cdk_invoice_processing_and_approval_prepare

This repository is the **invoice prepare monolith**: a **pure Node.js** harness that runs the same Lambda **handler sources** as the separate CDK project **`aws_cdk_invoice_processing_and_approval`**, using **in-memory mocks** only (no AWS account, no LocalStack, no Docker in this workflow).

Everything below applies **only to this repo’s layout and scripts** — not to `maz`, the WordPress workspace root, or any parent monorepo checkout unless you choose to nest this folder there.

---

## Scope of this repo

| In scope | Out of scope |
| -------- | ------------- |
| `src/` TypeScript server, mocks, orchestrator | Deploying infrastructure |
| `package.json` scripts (`npm run start`, `npm run dev`) | Documenting `maz/` or other repos |
| Env defaults in `src/prepare-env.ts` | Cognito/JWT simulation |

---

## Dependency on the CDK Lambda sources

At runtime this package **imports** TypeScript modules from a **sibling directory** next to this repository’s root on disk:

```text
src/**/*.ts  →  ../aws_cdk_invoice_processing_and_approval/lambda/**/*.ts
```

So your filesystem (or CI workspace) should look like:

```text
<parent>/
  aws_cdk_invoice_processing_and_approval/           # CDK app — clone separately
  aws_cdk_invoice_processing_and_approval_prepare/   # this repository (clone here)
```

Clone **this** repo and the CDK repo **side by side** under the same parent folder, or adjust paths — **do not** assume this README describes where `maz` or any other tree places those folders.

---

## What is mocked here

| AWS surface | Behaviour in this repo |
| ----------- | ------------------------ |
| **DynamoDB** | In-memory rows; see `src/memory-store.ts`. |
| **S3** | In-memory bytes; HTTP `PUT`/`GET` under `/internal/s3/...` in `src/app.ts`. |
| **SES** | Logged to stdout (`[prepare-ses]`). |
| **EventBridge** | Logged to stdout (`[prepare-events]`). |
| **Step Functions** | **`src/orchestrator.ts`** mocks **`SFNClient`** (`StartExecution` / `SendTaskSuccess`) via **aws-sdk-client-mock** — matches how **`upload-complete`** and **`public-api`** call Step Functions today. |

**Textract** is not called (`MOCK_TEXTRACT=1`), consistent with local emulation of the CDK **`stage=local`** behaviour.

### Alternative: **`src/orchestrator-using-promise.ts`** (no AWS SDK for orchestration)

Same Lambda handlers (**validate → notify-human → finalize**), but **`WAIT_FOR_TASK_TOKEN`** is simulated with a **`Promise`** and **`Map`** — **no** `@aws-sdk/client-sfn`, **no** `callsFake` wiring.

| Export | Role |
| ------ | ---- |
| **`runInvoiceWorkflow(input)`** | Runs validate → notify (with a random **`taskToken`**) → **`await`**s until **`sendTaskSuccess`** resolves that wait → runs **`finalize-human-approve`** or **`finalize-human-reject`**. |
| **`sendTaskSuccess(taskToken, output)`** | Replace **`SendTaskSuccess`** when integrating: **`output`** is the same JSON **`public-api`** would send (object or JSON string): **`{ "action": "APPROVE" \| "REJECT", "invoiceId", … }`**. |

This module **does not import** **`orchestrator.ts`** and is **not** hooked into **`src/server.ts`** by default (parallel reference only).

**How to use it**

1. **Script / REPL** — after **`MOCK_TEXTRACT`** and DynamoDB/S3 mocks are active (same **`prepare-env`** + **`registerSdkMocks`** pattern as the HTTP server), **`await runInvoiceWorkflow({ bucket, key, invoiceId, stage })`** in one async flow and call **`sendTaskSuccess(token, payload)`** from another tick when ready (token string is the one **`notify-human`** logged via DynamoDB **`taskToken`**, or pass through from **`runInvoiceWorkflow`** if you wrap it to expose the token).
2. **HTTP server variant** — replace **`upload-complete`’s** **`StartExecution`** path with **`runInvoiceWorkflow`** (or spawn it **`void …`** like **`StartExecution`** does today), and in **`POST /public/decision`** call **`sendTaskSuccess(taskTokenFromDb, body)`** instead of **`sfn.send(SendTaskSuccessCommand)`**. Remove **`InvoiceOrchestrator.wire()`** from **`setup-mocks`** if nothing else should mock SFN.

Until you wire it, treat **`orchestrator-using-promise.ts`** as documentation + copy-paste starting point for experiments.

---

## Install and run (this repo only)

```bash
cd aws_cdk_invoice_processing_and_approval_prepare
npm install
npm run start
```

- Default URL: `http://127.0.0.1:3333` (override with `PORT`, `PREPARE_PUBLIC_URL`, `PREPARE_HOST`).
- Watch mode: `npm run dev`
- Health: `GET /health`

---

## HTTP flow (quick test)

1. `POST /upload/presign` with header `x-presign-local-secret` (default `prepare-local-secret`).
2. `PUT` the file to the `uploadUrl` returned in JSON.
3. `POST /upload/complete` with `{ "bucket", "key" }` and the same secret header.
4. Use the `[invoice-notify local]` log line for the review URL, then `GET /public/invoice/:invoiceId?session=...`.
5. `POST /public/decision` with `invoiceId`, `session`, and `action` (`APPROVE` / `REJECT`).

---

## Environment

Defaults are set in **`src/prepare-env.ts`**. Override via process environment when starting this server.

---

## Moving work into the CDK repository

When handlers are ready, apply changes under **`aws_cdk_invoice_processing_and_approval/lambda/`** in that **other** repository, then use that repo’s normal CDK / LocalStack / CI flows. This repo does not replace those steps.

---

## Limitations (this harness)

- DynamoDB/S3 emulation is **minimal**, tailored to these Lambdas.
- `UpdateItem` parsing must be extended in `src/memory-store.ts` if new DynamoDB update shapes appear.
- No Cognito/JWT gateway simulation; local secret header matches CDK **`stage=local`** presign behaviour.
