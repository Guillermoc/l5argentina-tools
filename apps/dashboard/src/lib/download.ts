// Descarga forzada: proxea un blob del bucket (mismo origen que el dashboard) y
// lo re-sirve con Content-Disposition: attachment, así el navegador SIEMPRE lo
// baja con nombre propio (en vez de abrir un .json en una pestaña, como pasaría
// linkeando directo a la URL cross-origin de r2.dev). Se pasa el stream del
// upstream tal cual (sin bufferear), así aguanta archivos grandes. Solo `fetch`,
// corre igual en Node (dev), en el dev server de Vite y en la Pages Function.

export interface DownloadResult {
  status: number;
  error?: string;
  /** stream del cuerpo del upstream (sin leer); presente solo en éxito. */
  body?: ReadableStream<Uint8Array> | null;
  contentType?: string;
  /** Content-Length del upstream si vino (para que el navegador muestre progreso). */
  contentLength?: string | null;
  /** nombre del archivo para el attachment (ya saneado). */
  filename?: string;
}

/** Deja solo un nombre de archivo seguro (sin rutas ni comillas ni control). */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]+/g, "-")
    .replace(/[\x00-\x1f"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastSegment(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  return decodeURIComponent(path.split("/").pop() ?? "");
}

/**
 * Abre `rawUrl` (que DEBE vivir bajo `baseUrl`, el bucket público — evita
 * convertir el endpoint en un open-proxy) y devuelve el stream del cuerpo + el
 * nombre con el que hay que ofrecer la descarga. NO lee el cuerpo: el que llama
 * lo pasa directo a su respuesta (streaming).
 */
export async function fetchDownload(
  rawUrl: string,
  filenameHint: string,
  baseUrl: string,
): Promise<DownloadResult> {
  if (!rawUrl) return { status: 400, error: "falta url" };
  if (!rawUrl.startsWith(baseUrl)) return { status: 400, error: "url fuera del bucket" };

  try {
    const res = await fetch(rawUrl, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) return { status: res.status === 404 ? 404 : 502, error: `no se pudo bajar: HTTP ${res.status}` };
    return {
      status: 200,
      body: res.body,
      contentType: res.headers.get("content-type") || "application/octet-stream",
      contentLength: res.headers.get("content-length"),
      filename: sanitizeFilename(filenameHint) || lastSegment(rawUrl) || "download",
    };
  } catch (err) {
    return { status: 502, error: `no se pudo bajar: ${(err as Error).message}` };
  }
}

/** Header Content-Disposition con filename ascii + filename* UTF-8 (RFC 5987). */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
