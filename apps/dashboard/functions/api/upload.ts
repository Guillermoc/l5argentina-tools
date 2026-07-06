import { runUploadFile } from "../../src/lib/inbox";
import { runUploadLauncherFile } from "../../src/lib/launcher";
import type { R2Env } from "../../src/types";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pages Function: POST /api/upload  (body = bytes del archivo; nombre en X-L5A-Filename)
// Sube el adjunto al buzón. Mismo origen que el dashboard → sin CORS. El nombre del
// archivo define paquete + versión (convención <pkgId>-<X.Y.Z>.<ext>).
// Header X-L5A-Target: "launcher" → buzón del launcher (sunandmoon/inbox/); por
// defecto, el buzón de companion (inbox/).
export const onRequestPost = async (context: {
  request: Request;
  env: Partial<R2Env>;
}): Promise<Response> => {
  try {
    const name = decodeURIComponent(context.request.headers.get("x-l5a-filename") ?? "");
    const target = context.request.headers.get("x-l5a-target") ?? "";
    const bytes = await context.request.arrayBuffer();
    if (bytes.byteLength === 0) return json(400, { error: "archivo vacío" });
    const { status, body } =
      target === "launcher"
        ? await runUploadLauncherFile(name, bytes, context.env)
        : await runUploadFile(name, bytes, context.env);
    return json(status, body);
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
};
