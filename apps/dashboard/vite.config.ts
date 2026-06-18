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
