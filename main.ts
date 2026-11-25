// Token Launch Radar — the entry program (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json in the grader, --input <file|dir> elsewhere),
// prices every pre-token protocol with the model in lib/model.ts, and writes the hand-in:
//   board.json    the ranked board the gate scores
//   data.js       the dashboard's dataset, written beside dashboard/
//   dashboard/    the page itself, copied from this repository
//   screenshots/  the board, a detail view and a filtered view, copied from this repository
//   dossier.json  the judge's summary, written last with the vendored make.fun library
//
// The two grading runs must write the same bytes: nothing here reads a clock, a random source or
// the network, and every ordering ends in a slug tie-break, so the output is a pure function of
// the snapshot and this repository.
//
// Locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, restated so the program refuses before the scorer has to. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`token launch radar: ${message}\n`);
  process.exit(1);
}

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const { board, radar } = buildRadar(snapshot!);
const issue = boardIssue(board, snapshot!);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory tree of regular files, skipping dot-names, in name order. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const st = statSync(src);
    if (st.isDirectory()) copied.push(...copyTree(src, join(to, name)).map((n) => `${name}/${n}`));
    else if (st.isFile()) {
      copyFileSync(src, join(to, name));
      copied.push(name);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length === 0) fail('dashboard/ is empty: the page is half the entry');
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
  fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4 — the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
}

// The dossier goes last: the scorer rebuilds it from this very /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token launch radar: ${snapshot!.protocols.length} protocols scanned, ${snapshot!.watchlist.length} on the watchlist, ` +
    `${board.length} rows ranked (${radar.early_size} early), ${radar.live_size} live-token protocols set aside\n` +
    `token launch radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
