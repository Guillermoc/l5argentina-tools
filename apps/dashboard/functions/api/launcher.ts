import { listLauncher, runLauncher, type LauncherInput } from "../../src/lib/launcher";
import type { R2Env } from "../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: GET /api/launcher → manifest vivo del launcher + buzón (sunandmoon/inbox/).
export const onRequestGet = async (context: { env: Partial<R2Env> }): Promise<Response> => {
  try {
    return json(200, await listLauncher(context.env));
  } catch (err) {
    return json(502, { error: (err as Error).message });
  }
};

// Pages Function: POST /api/launcher  { op: "publish" | "discard" | "set-launcher", ... }
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<R2Env>;
}): Promise<Response> => {
  try {
    const input = (await context.request.json()) as LauncherInput;
    const { status, body } = await runLauncher(input, context.env);
    return json(status, body);
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
};
