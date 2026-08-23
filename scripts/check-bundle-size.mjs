#!/usr/bin/env node
/**
 * Bundle-size smoke test (task C3 / PLAN.md C4 "CI/CD-förbättringar").
 *
 * Scans `dist/` after a build and asserts the gzipped transfer weight of the
 * app bundle (JS + CSS + HTML — static assets like music/images are excluded)
 * stays under a budget. Fails the CI step with a clear report when exceeded.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs [--dir dist] [--limit 500]
 * Env:
 *   BUNDLE_DIR (default "dist"), BUNDLE_GZIP_LIMIT_KB (default 500)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_KB = Number(process.env.BUNDLE_GZIP_LIMIT_KB ?? 500);
const DIST_DIR = process.env.BUNDLE_DIR ?? 'dist';
/** File extensions that make up the application bundle. */
const INCLUDED_EXTENSIONS = new Set(['.js', '.css', '.html']);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

/**
 * Pure helper: total gzipped KiB over the given file paths (filtered by
 * extension). Read/stat are injectable so tests can exercise the math
 * without a real dist folder.
 */
export function measureGzipKb(paths, read = readFileSync, stat = statSync) {
  const included = paths.filter((p) => INCLUDED_EXTENSIONS.has(p.slice(p.lastIndexOf('.'))));
  let totalBytes = 0;
  const rows = included.map((path) => {
    const gzipped = gzipSync(read(path));
    totalBytes += gzipped.length;
    return {
      path,
      rawKiB: stat(path).size / 1024,
      gzipKiB: gzipped.length / 1024,
    };
  });
  return { rows, totalKiB: totalBytes / 1024 };
}

export function isMain() {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
  return invoked !== '' && invoked === fileURLToPath(import.meta.url);
}

function main() {
  if (!statSync(DIST_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`✖ bundle size check: "${DIST_DIR}" not found — run \`npm run build\` first.`);
    process.exit(2);
  }

  const { rows, totalKiB } = measureGzipKb(walk(DIST_DIR));
  if (rows.length === 0) {
    console.error(`✖ bundle size check: no .js/.css/.html output in "${DIST_DIR}".`);
    process.exit(2);
  }

  for (const row of rows.sort((a, b) => b.gzipKiB - a.gzipKiB)) {
    console.log(
      `  ${row.gzipKiB.toFixed(1)} KiB gzip · ${row.rawKiB.toFixed(1)} KiB raw · ${row.path}`,
    );
  }
  console.log(`  ${totalKiB.toFixed(1)} KiB gzip TOTAL (budget ${BUDGET_KB} KiB)`);

  if (totalKiB > BUDGET_KB) {
    console.error(`✖ bundle exceeds the ${BUDGET_KB} KiB gzip budget (${totalKiB.toFixed(1)} KiB).`);
    process.exit(1);
  }
  console.log(`✔ bundle size OK (${totalKiB.toFixed(1)} KiB gzip ≤ ${BUDGET_KB} KiB).`);
}

// Run only when executed directly (imported = test mode).
if (isMain()) main();
