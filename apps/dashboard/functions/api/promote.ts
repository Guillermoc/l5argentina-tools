import { runPromote } from "../../src/lib/promote";
import type { R2Env } from "../../src/types";

// Pages Function: POST /api/promote  { from, to, only?, apply? }
// Las credenciales R2 salen de las env vars del proyecto de Pages (context.env).
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<R2Env>;
}): Promise<Response> => {
  try {
    const input = await context.request.json();
    const { status, body } = await runPromote(input as never, context.env);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
