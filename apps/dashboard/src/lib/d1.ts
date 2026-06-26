import type { D1Env } from "../types";

/** Forma de cada bloque `result[]` que devuelve la HTTP API de D1. */
interface D1QueryResult<T> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

interface D1Response<T> {
  result?: D1QueryResult<T>[];
  success: boolean;
  errors?: { code: number; message: string }[];
}

/**
 * Cliente D1 vía su HTTP API (api.cloudflare.com/.../d1/database/<id>/query).
 * Mismo patrón que R2Writer: credenciales en env, mismo `fetch` en dev (Vite) y
 * en prod (Pages Function), sin binding ni wrangler. Cada llamada manda UNA
 * sentencia con parámetros posicionales (`?`).
 */
export class D1Client {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(env: D1Env) {
    const account = env.D1_ACCOUNT_ID || env.R2_ACCOUNT_ID;
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${env.D1_DATABASE_ID}/query`;
    this.token = env.D1_API_TOKEN;
  }

  /** Ejecuta una sentencia y devuelve las filas (vacío para INSERT/UPDATE/DDL). */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    let data: D1Response<T>;
    try {
      data = (await res.json()) as D1Response<T>;
    } catch {
      throw new Error(`D1 query → HTTP ${res.status} (respuesta no-JSON)`);
    }
    if (!res.ok || !data.success) {
      const msg = data.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new Error(`D1 query → ${msg}`);
    }
    return data.result?.[0]?.results ?? [];
  }
}

export function hasD1Env(env: Partial<D1Env> | undefined): env is D1Env {
  return Boolean((env?.D1_ACCOUNT_ID || env?.R2_ACCOUNT_ID) && env?.D1_DATABASE_ID && env?.D1_API_TOKEN);
}
