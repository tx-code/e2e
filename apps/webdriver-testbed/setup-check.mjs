import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const directory = import.meta.dirname;
const flags = new Set(process.argv.slice(2));
let stage = 'arguments';

/** Detects ordinary source edits after compilation; this is a freshness hint, not a content attestation. */
async function checkSources(source, output) {
  let entries;
  try { entries = await readdir(source, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.isDirectory()) await checkSources(path.join(source, entry.name), path.join(output, entry.name));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const input = await stat(path.join(source, entry.name));
      const compiled = await stat(path.join(output, entry.name.replace(/\.ts$/, '.js')));
      if (input.mtimeMs > compiled.mtimeMs + 1000) throw new Error('Source is newer than dist; rebuild e2e and @e2e-dev/webdriver with Corepack from the repository root');
    }
  }
}

try {
  if ([...flags].some((flag) => !['--preflight-only', '--video'].includes(flag))) throw new Error('Usage: node setup-check.mjs [--preflight-only] [--video]');
  stage = 'Node runtime';
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (!(major > 24 || (major === 24 && minor >= 8) || (major === 22 && (minor > 22 || (minor === 22 && patch >= 3))))) throw new Error('Node 22.22.3 or >=24.8.0 is required');
  console.log(`PASS Node ${process.versions.node}`);
  stage = 'dependencies/build';
  const roots = new Map();
  for (const name of ['e2e', '@e2e-dev/webdriver']) {
    const root = path.dirname(path.dirname(require.resolve(name)));
    roots.set(name, root);
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const stamp = JSON.parse(await readFile(path.join(root, 'dist', '.build.json'), 'utf8'));
    if (stamp.version !== metadata.version) throw new Error(`${name}: stale build version`);
    await checkSources(path.join(root, 'src'), path.join(root, 'dist'));
    console.log(`PASS built ${name}@${metadata.version}`);
  }
  stage = 'explicit driver';
  const { preflightEdgeDriver } = await import('@e2e-dev/webdriver/edge');
  const driver = process.env.WEBDRIVER_EDGE_DRIVER;
  if (!driver) throw new Error('Set WEBDRIVER_EDGE_DRIVER to the matching driver executable; no automatic download is performed');
  const checked = await preflightEdgeDriver({ driverPath: path.resolve(directory, driver) });
  console.log(`PASS driver ${checked.version} (${checked.sha256})`);
  if (flags.has('--video')) {
    stage = 'FFmpeg';
    const result = await execute(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 5000, maxBuffer: 262144 });
    if (!/\blibx264\b/.test(result.stdout)) throw new Error('FFmpeg must provide libx264');
    console.log('PASS FFmpeg libx264');
  }
  if (flags.has('--preflight-only')) {
    console.log('PREFLIGHT PASS; browser startup/cleanup, model login and product isolation have not been tested.');
  } else {
    stage = 'browser smoke';
    const output = `.e2e-setup-check-${randomUUID()}`;
    console.log(`Running two neutral cases three times; evidence: ${output}`);
    const result = await execute(process.execPath, [path.join(roots.get('e2e'), 'dist', 'cli', 'bin.js'), 'run', 'tests/controls.e2e.ts', '--repeat-each', '3', '--max-failures', '1', '--output', output, '--reporter', 'list,markdown', ...(flags.has('--video') ? ['--video'] : [])], {
      cwd: directory, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', WEBDRIVER_EDGE_DRIVER: checked.path },
      windowsHide: true, timeout: 600000, maxBuffer: 2_000_000,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    stage = 'smoke acceptance';
    const { checkAcceptance } = await import('@e2e-dev/webdriver/acceptance');
    const report = JSON.parse(await readFile(path.join(directory, output, 'report.json'), 'utf8'));
    const verdict = await checkAcceptance(report, { repeats: 3, cases: [
      { file: 'tests/controls.e2e.ts', title: 'native input and semantic locators', target: 'edge', screenshots: 1, steps: [] },
      { file: 'tests/controls.e2e.ts', title: 'locators resolve a replaced field and keyboard input', target: 'edge', screenshots: 0, steps: [] },
    ] }, path.join(directory, output, 'results'));
    if (!verdict.passed) throw new Error(verdict.issues.join('\n'));
    if (flags.has('--video') && report.run.results.filter((entry) => entry.selected).some((entry) => !entry.attempts[0]?.artifacts.some((artifact) => artifact.kind === 'video' && artifact.path && artifact.size > 0))) throw new Error('A requested video artifact is missing');
    console.log('SETUP SMOKE PASS: 6/6 clean attempts. No model calls, installs or downloads. Model login, video decoding and Tauri application isolation are outside this check.');
  }
} catch (error) {
  console.error(`SETUP FAILED [${stage}]: ${error.message}`);
  if (error.cause instanceof Error) console.error(error.cause.message);
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  if (stage === 'dependencies/build') console.error('From the repository root: corepack pnpm install --frozen-lockfile, then corepack pnpm --filter e2e run build and corepack pnpm --filter @e2e-dev/webdriver run build');
  if (stage === 'browser smoke' && error.killed) console.error('The smoke command exceeded its budget. Its resource cleanup is unconfirmed; do not treat this environment as ready.');
  process.exitCode = 1;
}
