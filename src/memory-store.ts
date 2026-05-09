import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import type { UpdateItemCommandInput } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

function attrValToJs(av: AttributeValue): unknown {
  const k = "_";
  return unmarshall({ [k]: av } as Record<string, AttributeValue>)[k];
}

/** Single-table PK-only mock keyed by invoiceId string. */
const rows = new Map<string, Record<string, AttributeValue>>();

/** S3 bytes keyed by `${bucket}/${key}` */
const objects = new Map<string, Buffer>();

export function ddbPut(tableName: string, item: Record<string, AttributeValue>) {
  const id = unmarshall(item).invoiceId as string;
  if (!id) throw new Error("ddbPut: missing invoiceId");
  rows.set(`${tableName}::${id}`, item);
}

export function ddbGet(tableName: string, key: Record<string, AttributeValue>) {
  const id = unmarshall(key).invoiceId as string;
  return rows.get(`${tableName}::${id}`);
}

/** Minimal UpdateItem support for SET / REMOVE used by invoice Lambdas. */
export function ddbUpdate(tableName: string, key: Record<string, AttributeValue>, input: UpdateItemCommandInput) {
  const id = unmarshall(key).invoiceId as string;
  const pk = `${tableName}::${id}`;
  let item = rows.get(pk);
  if (!item) {
    throw new Error(`ddbUpdate: no item ${pk}`);
  }
  let doc = unmarshall(item) as Record<string, unknown>;

  const names = input.ExpressionAttributeNames ?? {};
  const vals = input.ExpressionAttributeValues ?? {};
  const resolveName = (raw: string) => {
    if (raw.startsWith("#")) {
      const k = raw.slice(1);
      const full = `#${k}`;
      return names[full]?.replace(/^#/, "") ?? names[raw] ?? k;
    }
    return raw;
  };

  const expr = input.UpdateExpression ?? "";
  const parts = expr.split(/\s+REMOVE\s+/i);
  const setClause = parts[0].replace(/^SET\s+/i, "").trim();
  const removeClause = parts[1]?.trim() ?? "";

  if (setClause) {
    for (const chunk of splitTopLevelCommas(setClause)) {
      const m = chunk.match(/^(.+?)\s*=\s*(.+)$/);
      if (!m) continue;
      const lhs = m[1].trim();
      const rhs = m[2].trim();
      const attr = resolveName(lhs);
      if (!rhs.startsWith(":")) throw new Error(`ddbUpdate: expected value ref, got ${rhs}`);
      const val = vals[rhs];
      if (!val) throw new Error(`ddbUpdate: missing ${rhs}`);
      doc[attr] = attrValToJs(val);
    }
  }

  if (removeClause) {
    for (const rawAttr of splitTopLevelCommas(removeClause)) {
      const attr = resolveName(rawAttr.trim());
      delete doc[attr];
    }
  }

  item = marshall(doc, { removeUndefinedValues: true }) as Record<string, AttributeValue>;
  rows.set(pk, item);
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export function s3Put(bucket: string, key: string, body: Buffer) {
  objects.set(`${bucket}/${key}`, body);
}

export function s3Get(bucket: string, key: string): Buffer | undefined {
  return objects.get(`${bucket}/${key}`);
}

export function s3Has(bucket: string, key: string): boolean {
  return objects.has(`${bucket}/${key}`);
}
