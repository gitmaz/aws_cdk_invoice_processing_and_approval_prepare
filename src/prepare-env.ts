/**
 * Environment injected before Lambda modules load.
 * Mirrors CDK `stage=local` + MOCK_TEXTRACT so the same handlers run unchanged.
 */
export function applyPrepareEnv(port: number): void {
  const host = process.env.PREPARE_HOST ?? "127.0.0.1";
  const publicUrl = process.env.PREPARE_PUBLIC_URL ?? `http://${host}:${port}`;

  process.env.STAGE = "local";
  process.env.MOCK_TEXTRACT = "1";
  process.env.INVOICES_TABLE_NAME = process.env.INVOICES_TABLE_NAME ?? "invoice-records-prepare";
  process.env.INVOICES_BUCKET_NAME = process.env.INVOICES_BUCKET_NAME ?? "prepare-invoices-bucket";
  process.env.STATE_MACHINE_ARN =
    process.env.STATE_MACHINE_ARN ??
    "arn:aws:states:prepare:000000000000:stateMachine:invoice-processing-prepare";
  process.env.EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "invoice-events-prepare";
  process.env.OCR_CONFIDENCE_THRESHOLD = process.env.OCR_CONFIDENCE_THRESHOLD ?? "85";
  process.env.SES_FROM_ADDRESS = process.env.SES_FROM_ADDRESS ?? "prepare@example.com";
  process.env.SPA_BASE_URL = process.env.SPA_BASE_URL ?? "http://localhost:5173";
  process.env.HUMAN_REVIEW_EMAILS = process.env.HUMAN_REVIEW_EMAILS ?? "";
  process.env.REJECTION_NOTIFY_EMAILS = process.env.REJECTION_NOTIFY_EMAILS ?? "";
  process.env.PRESIGN_LOCAL_SECRET = process.env.PRESIGN_LOCAL_SECRET ?? "prepare-local-secret";
  /** Presign Lambda signs against this edge; we rewrite URLs to PREPARE_PUBLIC_URL paths anyway. */
  process.env.PRESIGN_PUBLIC_S3_ENDPOINT = publicUrl;
  process.env.PUBLIC_AWS_ENDPOINT_URL = publicUrl;
}
