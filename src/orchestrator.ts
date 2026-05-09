import { SendTaskSuccessCommand, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { randomUUID } from "crypto";
import { mockClient } from "aws-sdk-client-mock";

import * as finalizeApproveNs from "../../aws_cdk_invoice_processing_and_approval/lambda/finalize-human-approve/index.js";
import * as finalizeRejectNs from "../../aws_cdk_invoice_processing_and_approval/lambda/finalize-human-reject/index.js";
import * as notifyNs from "../../aws_cdk_invoice_processing_and_approval/lambda/notify-human/index.js";
import * as validateNs from "../../aws_cdk_invoice_processing_and_approval/lambda/validate/index.js";

const finalizeApproveHandler = finalizeApproveNs.handler;
const finalizeRejectHandler = finalizeRejectNs.handler;
const notifyHandler = notifyNs.handler;
const validateHandler = validateNs.handler;

type ExecInput = { bucket: string; key: string; invoiceId: string; stage: string };

/**
 * Approximates the CDK state machine: Validate → Notify (callback) → Choice → Finalize.
 */
export class InvoiceOrchestrator {
  private readonly pending = new Map<string, true>();

  constructor(private readonly sfnMock: ReturnType<typeof mockClient>) {}

  wire(): void {
    this.sfnMock.on(StartExecutionCommand).callsFake((input: { input?: string }) => this.onStart(input));
    this.sfnMock.on(SendTaskSuccessCommand).callsFake((input: { taskToken?: string; output?: string }) => this.onTaskSuccess(input));
  }

  private onStart(input: { input?: string }): Promise<{ executionArn: string; startDate: Date }> {
    const executionArn = `arn:aws:states:prepare:000000000000:execution:invoice-processing-prepare:${randomUUID()}`;
    const execInput = JSON.parse(String(input.input ?? "{}")) as ExecInput;

    void this.runPipeline(executionArn, execInput).catch((err) => {
      console.error("[prepare-sfn] pipeline error:", err);
    });

    return Promise.resolve({
      executionArn,
      startDate: new Date(),
    });
  }

  private async runPipeline(executionArn: string, execInput: ExecInput): Promise<void> {
    const validateOut = await validateHandler(execInput);
    const taskToken = `${executionArn}::wait`;

    this.pending.set(taskToken, true);

    await notifyHandler({
      bucket: validateOut.bucket,
      key: validateOut.key,
      invoiceId: validateOut.invoiceId,
      stage: validateOut.stage,
      minConfidence: validateOut.minConfidence,
      manualVerificationRequired: validateOut.manualVerificationRequired,
      taskToken,
    });
  }

  private async onTaskSuccess(input: { taskToken?: string; output?: string }): Promise<Record<string, never>> {
    const token = input.taskToken;
    if (!token || !this.pending.has(token)) {
      throw new Error(`[prepare-sfn] unknown or expired task token`);
    }
    this.pending.delete(token);

    const payload = JSON.parse(String(input.output ?? "{}")) as {
      action?: string;
      invoiceId?: string;
      editedFields?: Record<string, unknown>;
      reason?: string;
    };

    if (payload.action === "APPROVE") {
      await finalizeApproveHandler(payload as Parameters<typeof finalizeApproveHandler>[0]);
    } else if (payload.action === "REJECT") {
      await finalizeRejectHandler(payload as Parameters<typeof finalizeRejectHandler>[0]);
    } else {
      throw new Error(`[prepare-sfn] expected action APPROVE or REJECT`);
    }

    return {};
  }
}
