import { AwsClient } from "aws4fetch";
import type { R2Env } from "../types";

/** Objeto del bucket tal como lo devuelve ListObjectsV2 (forma mínima que usamos). */
export interface R2Object {
  key: string;
  sizeBytes: number;
  lastModified: string;
  etag: string;
}

/**
 * Escritor/lector R2 vía API S3 (aws4fetch). Funciona igual en Node (dev) y en
 * el runtime de Workers (Pages Function). Cubre lo que precisa el buzón: subir
 * texto, listar, copiar server-side (sin pasar los bytes por el Worker) y borrar.
 */
export class R2Writer {
  private readonly aws: AwsClient;
  private readonly base: string;
  private readonly bucket: string;

  constructor(env: R2Env) {
    this.aws = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      region: "auto",
      service: "s3",
    });
    this.bucket = env.R2_BUCKET;
    this.base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  }

  async putText(key: string, body: string, contentType: string, cacheControl: string): Promise<void> {
    await this.put(key, body, contentType, cacheControl);
  }

  /** Sube bytes (archivo adjunto) al bucket. */
  async putBytes(key: string, body: ArrayBuffer | Uint8Array, contentType: string, cacheControl: string): Promise<void> {
    await this.put(key, body as BodyInit, contentType, cacheControl);
  }

  private async put(key: string, body: BodyInit, contentType: string, cacheControl: string): Promise<void> {
    const res = await this.aws.fetch(`${this.base}/${key}`, {
      method: "PUT",
      body,
      headers: { "content-type": contentType, "cache-control": cacheControl },
    });
    if (!res.ok) {
      throw new Error(`R2 PUT ${key} → HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    }
  }

  /** Baja los bytes de un objeto (GET autenticado, sin caché). Lo usa el launcher
   *  para hashear el blob del buzón y para el read-modify-write del manifest. */
  async getBytes(key: string): Promise<ArrayBuffer> {
    const res = await this.aws.fetch(`${this.base}/${key}`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) {
      throw new Error(`R2 GET ${key} → HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    }
    return res.arrayBuffer();
  }

  /** Lista todos los objetos bajo un prefijo (sigue la paginación de S3). */
  async list(prefix: string): Promise<R2Object[]> {
    const out: R2Object[] = [];
    let token: string | undefined;
    do {
      const params = new URLSearchParams({ "list-type": "2", prefix });
      if (token) params.set("continuation-token", token);
      const res = await this.aws.fetch(`${this.base}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`R2 LIST ${prefix} → HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
      }
      const xml = await res.text();
      out.push(...parseListXml(xml));
      token = matchTag(xml, "NextContinuationToken");
      if (matchTag(xml, "IsTruncated") !== "true") token = undefined;
    } while (token);
    return out;
  }

  /** Copia server-side dentro del bucket (R2→R2, 0 bytes por el Worker), fijando
   *  content-type y cache-control nuevos en el destino. */
  async copy(srcKey: string, destKey: string, contentType: string, cacheControl: string): Promise<void> {
    const source = `/${this.bucket}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`;
    const res = await this.aws.fetch(`${this.base}/${destKey}`, {
      method: "PUT",
      headers: {
        "x-amz-copy-source": source,
        "x-amz-metadata-directive": "REPLACE",
        "content-type": contentType,
        "cache-control": cacheControl,
      },
    });
    if (!res.ok) {
      throw new Error(`R2 COPY ${srcKey} → ${destKey}: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    }
  }

  async delete(key: string): Promise<void> {
    const res = await this.aws.fetch(`${this.base}/${key}`, { method: "DELETE" });
    // S3 devuelve 204 al borrar (o 200). 404 lo tratamos como ya borrado.
    if (!res.ok && res.status !== 404) {
      throw new Error(`R2 DELETE ${key} → HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    }
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.aws.fetch(`${this.base}/${key}`, { method: "HEAD" });
    if (res.ok) return true;
    if (res.status === 404) return false;
    throw new Error(`R2 HEAD ${key} → HTTP ${res.status}`);
  }
}

export function hasR2Env(env: Partial<R2Env> | undefined): env is R2Env {
  return Boolean(
    env?.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  );
}

// --- parsing mínimo de la respuesta XML de ListObjectsV2 (sin DOMParser en Workers) ---

function matchTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseListXml(xml: string): R2Object[] {
  const items: R2Object[] = [];
  const blocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
  for (const b of blocks) {
    const key = matchTag(b, "Key");
    if (!key) continue;
    items.push({
      key: decodeEntities(key),
      sizeBytes: Number(matchTag(b, "Size") ?? 0),
      lastModified: matchTag(b, "LastModified") ?? "",
      etag: decodeEntities(matchTag(b, "ETag") ?? "").replace(/^"|"$/g, ""),
    });
  }
  return items;
}
