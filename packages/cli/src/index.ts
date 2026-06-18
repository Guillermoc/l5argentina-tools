#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { buildCommand } from "./commands/build";
import { statusCommand } from "./commands/status";
import { publishCommand } from "./commands/publish";
import { promoteCommand } from "./commands/promote";
import { migrateCommand } from "./commands/migrate";
import { verifyCommand } from "./commands/verify";
import { gcCommand } from "./commands/gc";

const program = new Command();

program
  .name("l5a")
  .description("Tooling del bucket R2 de L5Argentina (L5A)")
  .option("-a, --app <app>", "app a operar", "companion");

function app(cmd: Command): string {
  return cmd.optsWithGlobals().app as string;
}

program
  .command("build")
  .description("construye los artefactos desde las fuentes y los deja en dist/")
  .option("--no-write", "no escribir dist/ (solo mostrar el plan)")
  .action(function (this: Command, opts: { write?: boolean }) {
    buildCommand(app(this), opts);
  });

program
  .command("status")
  .description("matriz de versiones por canal")
  .action(function (this: Command) {
    statusCommand(app(this));
  });

program
  .command("publish")
  .description("publica las versiones actuales de la fuente a un canal (default: debug)")
  .option("-c, --channel <channel>", "canal destino", "debug")
  .option("--dry-run", "mostrar el plan sin tocar R2")
  .option("--commit", "tras publicar, commitea y pushea el estado (config/versions/lock/registry)")
  .action(async function (this: Command, opts: { channel: string; dryRun?: boolean; commit?: boolean }) {
    await publishCommand(app(this), opts);
  });

program
  .command("promote <from> <to>")
  .description("promueve versiones de un canal a otro (no copia bytes)")
  .option("--only <ids>", "solo estos paquetes (csv)")
  .option("--dry-run", "mostrar el diff sin tocar R2")
  .option("--commit", "tras promover, commitea y pushea el estado (config/versions/lock/registry)")
  .action(async function (this: Command, from: string, to: string, opts: { only?: string; dryRun?: boolean; commit?: boolean }) {
    await promoteCommand(app(this), from, to, opts);
  });

program
  .command("migrate")
  .description("migra un canal a la pool (copia server-side lo que ya existe, sube lo nuevo)")
  .option("-c, --channel <channel>", "canal a migrar", "debug")
  .option("--adopt", "usar las versiones que el canal tiene HOY en vivo (no versions.json)")
  .option("--apply", "ejecutar de verdad (default: plan / dry-run a dist/)")
  .option("--commit", "tras migrar, commitea y pushea el estado (config/versions/lock/registry)")
  .action(async function (this: Command, opts: { channel: string; adopt?: boolean; apply?: boolean; commit?: boolean }) {
    await migrateCommand(app(this), opts);
  });

program
  .command("verify")
  .description("verifica un canal contra el bucket en vivo (links, tamaños, same-origin)")
  .option("-c, --channel <channel>", "canal a verificar (default: todos)")
  .action(async function (this: Command, opts: { channel?: string }) {
    await verifyCommand(app(this), opts);
  });

program
  .command("gc")
  .description("lista/borra blobs del pool que ningún canal referencia")
  .option("--apply", "borrar de verdad (default: dry-run)")
  .action(async function (this: Command, opts: { apply?: boolean }) {
    await gcCommand(app(this), opts);
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
