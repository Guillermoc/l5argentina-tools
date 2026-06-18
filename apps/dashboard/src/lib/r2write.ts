import { AwsClient } from "aws4fetch";
import type { R2Env } from "../types";

/**
 * Escritor R2 vía API S3 (aws4fetch). Funciona igual en Node (dev) y en el
 * runtime de Workers (Pages Function). Solo PUT (lo único que precisa promover).
 */
export class R2Writer {
  private readonly aws: AwsClient;
  private readonly base: string;

  constructor(env: R2Env) {
    this.aws = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      region: "auto",
      service: "s3",
    });
    this.base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  }

  async putText(key: string, body: string, contentType: string, cacheControl: string): Promise<void> {
    const res = await this.aws.fetch(`${this.base}/${key}`, {
      method: "PUT",
      body,
      headers: { "content-type": contentType, "cache-control": cacheControl },
    });
    if (!res.ok) {
      throw new Error(`R2 PUT ${key} → HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    }
  }
}

export function hasR2Env(env: Partial<R2Env> | undefined): env is R2Env {
  return Boolean(
    env?.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  );
}
