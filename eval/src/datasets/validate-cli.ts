/**
 * Dataset validation CLI (M4-T01/T02).
 *
 *   pnpm -C eval exec tsx src/datasets/validate-cli.ts                 # full reqset
 *   pnpm -C eval exec tsx src/datasets/validate-cli.ts --require-gold  # T02 gate
 *   pnpm -C eval exec tsx src/datasets/validate-cli.ts --file dev      # one split file
 *
 * Exit code 0 = clean (warnings allowed); 1 = errors.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { DATASETS_DIR, latestReqsetVersion, loadReqset, validateReqset } from './load';
import { RefExampleSchema, RequestExampleSchema } from './schema';

function main(): void {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');

  if (fileIdx >= 0) {
    const split = args[fileIdx + 1];
    if (!split) throw new Error('--file needs a split name (dev|val|test|adv|ref|pfr)');
    const version = latestReqsetVersion();
    const path = join(DATASETS_DIR, version, `${split}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const schema = split === 'ref' ? z.array(RefExampleSchema) : z.array(RequestExampleSchema);
    const result = schema.safeParse(raw);
    if (!result.success) {
      console.error(`${split}.json: SCHEMA ERRORS`);
      for (const issue of result.error.issues.slice(0, 40)) {
        console.error(`  [${issue.path.join('.')}] ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`${split}.json OK — ${result.data.length} examples (${version})`);
    return;
  }

  const requireGold = args.includes('--require-gold');
  const reqset = loadReqset();
  const { errors, warnings } = validateReqset(reqset, { requireGold });
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
  const counts = reqset.manifest.counts;
  console.log(
    `${reqset.manifest.version}: dev ${counts.dev} · val ${counts.val} · test ${counts.test} · ` +
      `adv ${counts.adv} · ref ${counts.ref} · pfr ${counts.pfr} — ` +
      `${errors.length} errors, ${warnings.length} warnings`,
  );
  if (errors.length > 0) process.exitCode = 1;
}

main();
