-- Marca por fila: pending = 1 cuando la regla cambió desde la última emisión
-- (todavía no publicada). El tooling también la agrega on-demand (ensureSchema),
-- pero esta migración la deja explícita para `wrangler d1`.
--
-- Aplicar:  wrangler d1 execute l5a-rules --remote --file=migrations/0002_rules_pending.sql
ALTER TABLE rules ADD COLUMN pending INTEGER NOT NULL DEFAULT 1;
