import { importRulesFromChannel } from "../../../src/lib/rules";
import type { D1Env } from "../../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: POST /api/rules/import-channel  { channel?: "debug" }
// Importa a D1 el rules-*.json publicado en ese canal (default debug).
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<D1Env>;
}): Promise<Response> => {
  try {
    const { channel } = (await context.request.json().catch(() => ({}))) as { channel?: string };
    const { status, body } = await importRulesFromChannel(channel || "debug", context.env);
    return json(status, body);
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
};
