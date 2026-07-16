import { runSubmitReview } from "../../src/lib/reviews";
import type { R2Env } from "../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: POST /api/reviews  { analisis, fecha_reporte?, db?, decisions }
// Escribe tools/reports/decisions/<analisis>-review.json y marca la entrada
// del índice como revisada. Mismo patrón aws4fetch que promote/upload.
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<R2Env>;
}): Promise<Response> => {
  try {
    const input = await context.request.json();
    const { status, body } = await runSubmitReview(input as never, context.env);
    return json(status, body);
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
};
