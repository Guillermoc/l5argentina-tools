-- Esquema D1 para el editor de reglas. La PK por `title` evita cargar dos veces
-- la misma carta. El tooling también la crea on-demand (CREATE TABLE IF NOT EXISTS
-- en lib/rules.ts), pero esta migración la deja explícita para `wrangler d1`.
--
-- Aplicar:  wrangler d1 execute l5a-rules --remote --file=migrations/0001_rules.sql
CREATE TABLE IF NOT EXISTS rules (
  title              TEXT PRIMARY KEY,
  max_copies         INTEGER,
  banned             INTEGER NOT NULL DEFAULT 0,
  preferred_printing TEXT,
  note               TEXT,
  label_text         TEXT,
  label_color        TEXT,
  highlight_color    TEXT,
  updated_at         TEXT NOT NULL
);
