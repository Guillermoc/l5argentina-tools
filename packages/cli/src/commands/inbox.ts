import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import {
  R2,
  INBOX_PREFIX,
  parseInboxKey,
  inboxKey,
  splitVersion,
  bumpVersion,
  poolKey,
  poolUrl,
  manifestKey,
  contentType,
  buildManifest,
  validateManifest,
  registryPut,
  writeRemoteRegistry,
  writeRemoteLock,
} from "@l5a/core";
import { loadContext, fmtBytes } from "../context";

const TARGET = "debug";

interface InboxFile {
  key: string;
  pkgId: string;
  ext: string;
  version?: string;
}

/** Lista las claves del buzón ya parseadas (pkgId/ext/version del nombre). */
async function listInbox(r2: R2): Promise<InboxFile[]> {
  const keys = await r2.list(INBOX_PREFIX + "/");
  return keys
    .map((key) => {
      const p = parseInboxKey(key);
      return p ? { key, ...p } : null;
    })
    .filter((f): f is InboxFile => f != null);
}

/** Lista el buzón con la versión que cada paquete tiene hoy en debug. */
export async function inboxLsCommand(app: string): Promise<void> {
  const ctx = await loadContext(app);
  const r2 = R2.fromEnv();
  const files = await listInbox(r2);
  const debugState = ctx.lock.channels[TARGET] ?? {};
  const typeById = new Map(ctx.config.packages.map((p) => [p.id, p.type]));

  console.log(`\nbuzón · app "${app}"\n`);
  if (files.length === 0) {
    console.log("  (vacío)\n");
    return;
  }
  for (const { key, pkgId, ext, version } of files) {
    const size = (await r2.headSize(key)) ?? 0;
    const type = typeById.get(pkgId) ?? "?";
    const cur = debugState[pkgId] ?? "—";
    const target = version ?? bumpVersion(debugState[pkgId]);
    const origen = version ? "del nombre" : "sugerido";
    const known = typeById.has(pkgId) ? "" : "  ⚠ desconocido";
    console.log(
      `  ${pkgId.padEnd(12)} ${type.padEnd(10)} .${ext.padEnd(4)} ${fmtBytes(size).padStart(9)}   debug=${cur} → ${target} (${origen})${known}`,
    );
  }
  console.log("");
}

/**
 * Sube un archivo local al buzón. La versión se toma del nombre del archivo si
 * sigue la convención `<algo>-<X.Y.Z>.<ext>`; si no, queda sin versión.
 */
export async function inboxPutCommand(app: string, pkgId: string, file: string): Promise<void> {
  await loadContext(app); // valida que la app exista
  const bytes = new Uint8Array(readFileSync(file));
  const ext = extname(file).replace(/^\./, "") || "bin";
  const stem = basename(file, extname(file));
  const { version } = splitVersion(stem);
  const key = inboxKey(pkgId, ext, version);
  const r2 = R2.fromEnv();
  await r2.putBlob(key, bytes, contentType(ext));
  console.log(`\n  ✓ ${basename(file)} → ${key}  (${fmtBytes(bytes.length)})\n`);
}

interface SendOpts {
  version?: string;
  apply?: boolean;
}

/** Envía un archivo del buzón a debug: copia a la pool, actualiza estado y manifest. */
export async function inboxSendCommand(app: string, pkgId: string, opts: SendOpts): Promise<void> {
  const ctx = await loadContext(app);
  const pkg = ctx.config.packages.find((p) => p.id === pkgId);
  if (!pkg) {
    throw new Error(`"${pkgId}" no es un paquete conocido (revisá apps/${app}/app.config.json)`);
  }
  const r2 = R2.fromEnv();

  // localizar el archivo (puede haber varias versiones del mismo paquete)
  const candidates = (await listInbox(r2)).filter((f) => f.pkgId === pkgId);
  if (candidates.length === 0) throw new Error(`no hay ningún archivo en el buzón para "${pkgId}"`);
  let chosen: InboxFile | undefined;
  if (opts.version) {
    chosen = candidates.find((c) => c.version === opts.version) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!chosen) {
      throw new Error(
        `hay varios archivos para "${pkgId}" y ninguno con versión ${opts.version} en el nombre: ${candidates.map((c) => basename(c.key)).join(", ")}`,
      );
    }
  } else if (candidates.length > 1) {
    throw new Error(
      `hay varios archivos en el buzón para "${pkgId}": ${candidates.map((c) => basename(c.key)).join(", ")} — elegí con --version`,
    );
  } else {
    chosen = candidates[0]!;
  }
  const srcKey = chosen.key;
  const sizeBytes = (await r2.headSize(srcKey)) ?? 0;

  const debugState = { ...(ctx.lock.channels[TARGET] ?? {}) };
  const version = (opts.version ?? chosen.version ?? bumpVersion(debugState[pkgId])).trim();
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error(`versión inválida: "${version}" (usá algo tipo 2.1.2)`);
  if (ctx.registry[pkgId]?.[version]) {
    throw new Error(`${pkgId}@${version} ya está publicada (las versiones son inmutables) — usá otra versión`);
  }

  const key = poolKey(ctx.config, { id: pkgId, type: pkg.type }, version, chosen.ext);
  const url = poolUrl(ctx.config, key);

  console.log(`\ninbox send · "${pkgId}" → ${TARGET}${opts.apply ? "" : " (dry-run)"}\n`);
  console.log(`  archivo:  ${basename(srcKey)}`);
  console.log(`  versión:  ${debugState[pkgId] ?? "—"} → ${version}${chosen.version ? "" : "  (sugerida)"}`);
  console.log(`  tamaño:   ${fmtBytes(sizeBytes)}`);
  console.log(`  pool:     ${key}`);

  if (!opts.apply) {
    console.log(`\n  (dry-run: no se tocó R2. Agregá --apply para enviar.)\n`);
    return;
  }

  // 1) copia server-side inbox → pool (no re-sube bytes)
  if (await r2.exists(key)) {
    console.log(`    · ${key} ya existe, no se re-copia`);
  } else {
    await r2.copy(srcKey, key);
    console.log(`    ✓ copiado a la pool`);
  }

  // registry + lock(debug) en memoria, y manifest validado ANTES de tocar R2
  registryPut(ctx.registry, pkgId, version, { sha256: "", sizeBytes, url, type: pkg.type, ext: chosen.ext });
  debugState[pkgId] = version;
  ctx.lock.channels[TARGET] = debugState;
  const manifest = buildManifest(ctx.config, debugState, ctx.registry);
  const errors = validateManifest(manifest, ctx.config.baseUrl);
  if (errors.length) throw new Error("manifest inválido:\n  - " + errors.join("\n  - "));

  // se persiste el estado interno (_state/) ANTES del manifest que lee la app
  await writeRemoteRegistry(r2, ctx.registry);
  await writeRemoteLock(r2, ctx.lock);
  await r2.putManifest(manifestKey(TARGET), JSON.stringify(manifest, null, 2) + "\n");

  // consumido: se saca del buzón
  await r2.deleteMany([srcKey]);

  console.log(`\n  ✓ enviado. debug/manifest.json + estado (_state/) actualizados; buzón limpio.\n`);
}

/** Descarta archivo(s) del buzón sin publicarlos. Con --version, solo ese. */
export async function inboxRmCommand(app: string, pkgId: string, opts: { version?: string }): Promise<void> {
  await loadContext(app);
  const r2 = R2.fromEnv();
  const toDelete = (await listInbox(r2))
    .filter((f) => f.pkgId === pkgId && (!opts.version || f.version === opts.version))
    .map((f) => f.key);
  if (toDelete.length === 0) {
    throw new Error(`no hay ningún archivo en el buzón para "${pkgId}"${opts.version ? ` versión ${opts.version}` : ""}`);
  }
  await r2.deleteMany(toDelete);
  console.log(`\n  ✓ descartado del buzón: ${toDelete.join(", ")}\n`);
}
