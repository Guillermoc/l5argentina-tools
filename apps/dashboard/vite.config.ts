import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// Plugin de dev: sirve /api/status localmente reusando la MISMA lógica que la
// Pages Function de producción, así `npm run dev` funciona sin wrangler.
function devApi() {
  return {
    name: "l5a-dev-api",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url || !req.url.startsWith("/api/status")) return next();
        (async () => {
          try {
            const { fetchStatus } = await import("./src/lib/status");
            const { appConfig } = await import("./src/generated/companion");
            const data = await fetchStatus(appConfig);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(data));
          } catch (err) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), devApi()],
});
