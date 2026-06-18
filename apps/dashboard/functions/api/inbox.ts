import { listInbox, runInbox, type InboxInput } from "../../src/lib/inbox";
import type { R2Env } from "../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: GET /api/inbox → lista el buzón.
export const onRequestGet = async (context: { env: Partial<R2Env> }): Promise<Response> => {
  try {
    return json(200, await listInbox(context.env));
  } catch (err) {
    return json(502, { error: (err as Error).message });
  }
};

// Pages Function: POST /api/inbox  { op: "upload" | "send" | "discard", ... }
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<R2Env>;
}): Promise<Response> => {
  try {
    const input = (await context.request.json()) as InboxInput;
    const { status, body } = await runInbox(input, context.env);
    return json(status, body);
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
};
