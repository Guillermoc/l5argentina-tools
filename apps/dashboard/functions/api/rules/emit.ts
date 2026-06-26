import { emitRules } from "../../../src/lib/rules";
import type { D1Env, R2Env } from "../../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: POST /api/rules/emit  { version, apply }
// Snapshot del D1 → rules-<version>.json al buzón (de ahí → debug → promover).
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<D1Env & R2Env>;
}): Promise<Response> => {
  try {
    const { version, apply } = (await context.request.json()) as { version: string; apply?: boolean };
    const { status, body } = await emitRules(version, Boolean(apply), context.env);
    return json(status, body);
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
};
