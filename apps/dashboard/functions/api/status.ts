import { fetchStatus } from "../../src/lib/status";
import { appConfig } from "../../src/generated/companion";

// Pages Function: GET /api/status
// Baja los 3 manifests del lado servidor (sin CORS) y los devuelve agregados.
export const onRequest = async (): Promise<Response> => {
  try {
    const data = await fetchStatus(appConfig);
    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
