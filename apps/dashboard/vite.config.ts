import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import dotenv from "dotenv";

// En dev, carga las credenciales R2 del .env de la raíz del repo (para /api/promote).
dotenv.config({ path: "../../.env" });

function readBody(req: any): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: any) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

function readRawBody(req: any): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });
}

// Plugin de dev: sirve /api/* localmente reusando la MISMA lógica que las Pages
// Functions de producción, así `npm run dev` funciona sin wrangler.
function devApi() {
  return {
    name: "l5a-dev-api",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url: string = req.url ?? "";
        if (!url.startsWith("/api/")) return next();
        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        (async () => {
          try {
            if (url.startsWith("/api/status")) {
              const { fetchStatus } = await import("./src/lib/status");
              const { appConfig } = await import("./src/generated/companion");
              return json(200, await fetchStatus(appConfig));
            }
            if (url.startsWith("/api/promote") && req.method === "POST") {
              const { runPromote } = await import("./src/lib/promote");
              const input = JSON.parse((await readBody(req)) || "{}");
              const { status, body } = await runPromote(input, process.env as never);
              return json(status, body);
            }
            if (url.startsWith("/api/upload") && req.method === "POST") {
              const { runUploadFile } = await import("./src/lib/inbox");
              const name = decodeURIComponent((req.headers["x-l5a-filename"] as string) ?? "");
              const bytes = await readRawBody(req);
              const { status, body } = await runUploadFile(name, bytes, process.env as never);
              return json(status, body);
            }
            if (url.startsWith("/api/rules/emit") && req.method === "POST") {
              const { emitRules } = await import("./src/lib/rules");
              const { version, apply } = JSON.parse((await readBody(req)) || "{}");
              const { status, body } = await emitRules(version, Boolean(apply), process.env as never);
              return json(status, body);
            }
            if (url.startsWith("/api/rules/import-channel") && req.method === "POST") {
              const { importRulesFromChannel } = await import("./src/lib/rules");
              const { channel } = JSON.parse((await readBody(req)) || "{}");
              const { status, body } = await importRulesFromChannel(channel || "debug", process.env as never);
              return json(status, body);
            }
            if (url.startsWith("/api/rules/refresh-titles") && req.method === "POST") {
              const { refreshCardTitlesFromDebug } = await import("./src/lib/cardTitles");
              const count = await refreshCardTitlesFromDebug(process.env as never);
              return json(200, { ok: true, count });
            }
            if (url.startsWith("/api/rules")) {
              if (req.method === "POST") {
                const { runRules } = await import("./src/lib/rules");
                const input = JSON.parse((await readBody(req)) || "{}");
                const { status, body } = await runRules(input, process.env as never);
                return json(status, body);
              }
              const { listRules } = await import("./src/lib/rules");
              return json(200, await listRules(process.env as never));
            }
            if (url.startsWith("/api/inbox")) {
              if (req.method === "POST") {
                const { runInbox } = await import("./src/lib/inbox");
                const input = JSON.parse((await readBody(req)) || "{}");
                const { status, body } = await runInbox(input, process.env as never);
                return json(status, body);
              }
              const { listInbox } = await import("./src/lib/inbox");
              return json(200, await listInbox(process.env as never));
            }
            return json(404, { error: "not found" });
          } catch (err) {
            return json(500, { error: (err as Error).message });
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), devApi()],
});
