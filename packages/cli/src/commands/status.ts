import { loadContext } from "../context";

/** Matriz de versiones por canal (lee channels.lock.json). */
export function statusCommand(app: string): void {
  const ctx = loadContext(app);
  const channels = ctx.config.channels;

  console.log(`\nstatus · app "${app}"\n`);

  const idW = Math.max(...ctx.config.packages.map((p) => p.id.length), 8);
  const colW = Math.max(...channels.map((c) => c.length), 10);

  const header =
    "  " + "package".padEnd(idW) + "  " + channels.map((c) => c.padEnd(colW)).join("");
  console.log(header);
  console.log("  " + "-".repeat(header.length - 2));

  for (const pkg of ctx.config.packages) {
    const cells = channels.map((c) => (ctx.lock.channels[c]?.[pkg.id] ?? "—").padEnd(colW));
    const versions = new Set(channels.map((c) => ctx.lock.channels[c]?.[pkg.id] ?? "—"));
    const flag = versions.size > 1 ? " ◂ difiere" : "";
    console.log("  " + pkg.id.padEnd(idW) + "  " + cells.join("") + flag);
  }
  console.log("");
}
