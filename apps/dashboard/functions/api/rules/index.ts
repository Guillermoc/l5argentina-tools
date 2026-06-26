import { listRules, runRules, type RulesInput } from "../../../src/lib/rules";
import type { D1Env } from "../../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: GET /api/rules → lista las reglas (del D1).
export const onRequestGet = async (context: { env: Partial<D1Env> }): Promise<Response> => {
  try {
    return json(200, await listRules(context.env));
  } catch (err) {
    return json(502, { error: (err as Error).message });
  }
};

// Pages Function: POST /api/rules  { op: "upsert" | "delete", ... }
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<D1Env>;
}): Promise<Response> => {
  try {
    const input = (await context.request.json()) as RulesInput;
    const { status, body } = await runRules(input, context.env);
    return json(status, body);
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
};
