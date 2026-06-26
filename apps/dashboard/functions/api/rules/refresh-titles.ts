import { refreshCardTitlesFromDebug } from "../../../src/lib/cardTitles";
import type { R2Env } from "../../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: POST /api/rules/refresh-titles
// Regenera _state/card-titles.json desde el cards_db que hay en debug (bootstrap
// o regeneración manual; el envío de cards_db a debug ya lo hace automático).
export const onRequestPost = async (context: { env: Partial<R2Env> }): Promise<Response> => {
  try {
    const count = await refreshCardTitlesFromDebug(context.env);
    return json(200, { ok: true, count });
  } catch (err) {
    return json(502, { error: (err as Error).message });
  }
};
