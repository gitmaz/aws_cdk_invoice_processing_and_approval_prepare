/**
 * Alternative to **`./orchestrator.ts`** (SFN mock via aws-sdk-client-mock): same Lambda handlers,
 * **`WAIT_FOR_TASK_TOKEN`** simulated with a **`Promise`** and a **`Map<string, resolver>`**.
 *
 * Does **not** import or use **`./orchestrator.ts`** — kept as a parallel reference implementation.
 * Not wired into **`server.ts`** by default.
 */

import { randomUUID } from "crypto";

import * as finalizeApproveNs from "../../aws_cdk_invoice_processing_and_approval/lambda/finalize-human-approve/index.js";
import * as finalizeRejectNs from "../../aws_cdk_invoice_processing_and_approval/lambda/finalize-human-reject/index.js";
import * as notifyNs from "../../aws_cdk_invoice_processing_and_approval/lambda/notify-human/index.js";
import * as validateNs from "../../aws_cdk_invoice_processing_and_approval/lambda/validate/index.js";

const finalizeApproveHandler = finalizeApproveNs.handler;
const finalizeRejectHandler = finalizeRejectNs.handler;
const notifyHandler = notifyNs.handler;
const validateHandler = validateNs.handler;

export type ExecInput = { bucket: string; key: string; invoiceId: string; stage: string };

/** Same JSON shape API Gateway passes to `SendTaskSuccess` → finalize Lambdas. */
export type CallbackPayload = {
  action: "APPROVE" | "REJECT";
  invoiceId: string;
  editedFields?: Record<string, unknown>;
  reason?: string;
};

type WaitingEntry = {
  resolve: (value: CallbackPayload) => void;
  reject: (reason?: unknown) => void;
};

const waitingTasks = new Map<string, WaitingEntry>();

/**
 * Linear workflow: **validate** → **notify** (email + DB + task token) → wait for **`sendTaskSuccess`** → **finalize**.
 *
 * Mirrors the reference pattern: register the waiter **after** notify returns (same order as the sample snippet).
 */
export async function runInvoiceWorkflow(input: ExecInput): Promise<unknown> {
  const validateOut = await validateHandler(input);

  const token = randomUUID();

  await notifyHandler({
    bucket: validateOut.bucket,
    key: validateOut.key,
    invoiceId: validateOut.invoiceId,
    stage: validateOut.stage,
    minConfidence: validateOut.minConfidence,
    manualVerificationRequired: validateOut.manualVerificationRequired,
    taskToken: token,
  });

  const approvalData = await new Promise<CallbackPayload>((resolve, reject) => {
    waitingTasks.set(token, { resolve, reject });
  });

  if (approvalData.action === "APPROVE") {
    return finalizeApproveHandler(
      approvalData as Parameters<typeof finalizeApproveHandler>[0],
    );
  }
  if (approvalData.action === "REJECT") {
    return finalizeRejectHandler(
      approvalData as Parameters<typeof finalizeRejectHandler>[0],
    );
  }

  throw new Error("[prepare-promise] callback must set action to APPROVE or REJECT");
}

/**
 * Call when the human completes review (replaces **`SFN.SendTaskSuccess`** + mocked client).
 * **`output`** may be the object or JSON string (same as Step Functions **`output`** field).
 */
export function sendTaskSuccess(taskToken: string, output: string | CallbackPayload): void {
  const task = waitingTasks.get(taskToken);
  if (!task) {
    throw new Error("[prepare-promise] invalid or expired task token");
  }

  const payload =
    typeof output === "string"
      ? (JSON.parse(output) as CallbackPayload)
      : output;

  task.resolve(payload);
  waitingTasks.delete(taskToken);
}
