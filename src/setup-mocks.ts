import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SFNClient } from "@aws-sdk/client-sfn";
import { mockClient } from "aws-sdk-client-mock";

import * as memory from "./memory-store.js";

let sfnMockSingleton: ReturnType<typeof mockClient> | undefined;

/** Register SDK mocks before any Lambda module is imported. */
export function registerSdkMocks(): ReturnType<typeof mockClient> {
  const ddb = mockClient(DynamoDBClient);

  ddb.on(PutItemCommand).callsFake((input) => {
    if (!input.TableName || !input.Item) throw new Error("PutItem: missing table/item");
    memory.ddbPut(input.TableName, input.Item);
    return {};
  });

  ddb.on(GetItemCommand).callsFake((input) => {
    if (!input.TableName || !input.Key) throw new Error("GetItem: missing table/key");
    const item = memory.ddbGet(input.TableName, input.Key);
    return { Item: item };
  });

  ddb.on(UpdateItemCommand).callsFake((input) => {
    if (!input.TableName || !input.Key) throw new Error("UpdateItem: missing table/key");
    memory.ddbUpdate(input.TableName, input.Key, input);
    return {};
  });

  const s3 = mockClient(S3Client);

  s3.on(GetObjectCommand).callsFake((input) => {
    const bucket = input.Bucket!;
    const key = input.Key!;
    const buf = memory.s3Get(bucket, key);
    if (!buf) {
      const err = new Error("NoSuchKey");
      (err as NodeJS.ErrnoException).name = "NoSuchKey";
      throw err;
    }
    return {
      Body: {
        transformToByteArray: async () => new Uint8Array(buf),
      },
    };
  });

  s3.on(PutObjectCommand).callsFake((input) => {
    const bucket = input.Bucket!;
    const key = input.Key!;
    const body = input.Body;
    let buf: Buffer;
    if (Buffer.isBuffer(body)) buf = body;
    else if (body instanceof Uint8Array) buf = Buffer.from(body);
    else if (typeof body === "string") buf = Buffer.from(body);
    else throw new Error("PutObject: unsupported Body type");
    memory.s3Put(bucket, key, buf);
    return { ETag: '"prepare-mock"' };
  });

  const ses = mockClient(SESClient);
  ses.on(SendEmailCommand).callsFake((input) => {
    const dest = input.Destination?.ToAddresses?.join(", ") ?? "";
    console.log(`[prepare-ses] SendEmail → ${dest}: ${input.Message?.Subject?.Data ?? "(no subject)"}`);
    return { MessageId: `prepare-${Date.now()}` };
  });

  const eb = mockClient(EventBridgeClient);
  eb.on(PutEventsCommand).callsFake((input) => {
    for (const e of input.Entries ?? []) {
      console.log(`[prepare-events] ${e.DetailType ?? "?"}: ${e.Detail ?? ""}`);
    }
    return { Entries: (input.Entries ?? []).map(() => ({ EventId: "prepare" })) };
  });

  sfnMockSingleton = mockClient(SFNClient);
  return sfnMockSingleton;
}

export async function wireOrchestrator(): Promise<void> {
  if (!sfnMockSingleton) throw new Error("registerSdkMocks() first");
  const { InvoiceOrchestrator } = await import("./orchestrator.js");
  new InvoiceOrchestrator(sfnMockSingleton).wire();
}
