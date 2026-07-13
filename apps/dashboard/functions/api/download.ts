import { contentDisposition, fetchDownload } from "../../src/lib/download";
import { appConfig } from "../../src/generated/companion";

// Pages Function: GET /api/download?url=<urlDelBucket>&name=<nombre>
// Proxea el blob (mismo origen → sin CORS) y lo fuerza como descarga.
export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const u = new URL(context.request.url);
  const rawUrl = u.searchParams.get("url") ?? "";
  const name = u.searchParams.get("name") ?? "";
  const out = await fetchDownload(rawUrl, name, appConfig.baseUrl);
  if (out.error) {
    return new Response(JSON.stringify({ error: out.error }), {
      status: out.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const headers: Record<string, string> = {
    "content-type": out.contentType!,
    "content-disposition": contentDisposition(out.filename!),
    "cache-control": "no-store",
  };
  if (out.contentLength) headers["content-length"] = out.contentLength;
  // Pasa el stream del upstream sin bufferear (aguanta archivos grandes).
  return new Response(out.body ?? null, { status: 200, headers });
};
