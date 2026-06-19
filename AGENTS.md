# AGENTS.md

Contexto para agentes de IA. **El detalle completo está en [CLAUDE.md](CLAUDE.md)** — leelo primero.
Para humanos: [README.md](README.md), [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md),
[docs/COMMANDS.md](docs/COMMANDS.md), [docs/BUCKET.md](docs/BUCKET.md).

## Esencial

Tooling (CLI `l5a` + dashboard) para gestionar el bucket Cloudflare R2 de L5Argentina. Monorepo
TypeScript: `packages/core` (motor) + `packages/cli` (CLI vía tsx, sin build) + `apps/dashboard`
(React/Vite/Pages, standalone). La **config/inputs** viven en `apps/<app>/*.json` (git); el
**estado** (registry + lock) vive en **R2** (`_state/`), no en git.

Verificar cambios:
```bash
npm run typecheck                              # raíz (CLI/core)
cd apps/dashboard && npm run build             # dashboard
```

## Reglas que NO se rompen

- Los comandos `--apply` escriben a un bucket en vivo que usan ~25 usuarios reales: **dry-run
  primero, mostrar el plan, confirmar antes de ejecutar**. No hacer pushes ni acciones
  outward-facing sin pedido explícito del usuario.
- No commitear `assets/`, `dist/`, `.env` ni `apps/dashboard/src/generated/` (gitignored).
- No tocar `sunandmoon/` (otra app) ni las sub-features `*/history|news|tournament|rulebooks/`
  del bucket (contenido real, aún no gestionado por el tooling).
- No cambiar el Public Dev URL del bucket ni volver relativas las URLs del manifest.
- Commits y comentarios en español.
