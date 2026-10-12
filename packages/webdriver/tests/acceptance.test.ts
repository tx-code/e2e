import { describe, it, expect } from 'vitest';
import { checkAcceptance } from '../src/acceptance.ts';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const policy = { repeats: 1, cases: [{ file: 'tests/check.e2e.ts', title: 'check', target: 'fixture', screenshots: 0, steps: [] }] };
/** A literal successful report, independent of the acceptance implementation. */
function report() {
  return { schemaVersion: 'report-1', run: { id: 'run', status: 'passed', exitCode: 0, errors: [], serialGroups: [], results: [{
    file: 'tests/check.e2e.ts', titlePath: ['check'], targetId: 'fixture', repeat: 0, selected: true, status: 'passed', attempts: [{
      id: 'attempt', status: 'passed', cleanup: 'complete', secondaryErrors: [], steps: [] as unknown[], artifacts: [] as unknown[],
    }],
  }] } };
}

describe('strict report acceptance', () => {
  it('checks declared model identity and refuses visual input', async () => {
    const input = report();
    const step = { api: 'agent.assert', status: 'passed', model: { provider: 'fixture', model: 'judge' }, visionInput: false };
    input.run.results[0]!.attempts[0]!.steps.push(step);
    const configured = { ...policy, model: { provider: 'fixture', model: 'judge' }, cases: [{ ...policy.cases[0], steps: [{ api: 'agent.assert', status: 'passed' }] }] };
    expect((await checkAcceptance(input, configured, process.cwd())).passed).toBe(true);
    step.model.model = 'unexpected';
    expect((await checkAcceptance(input, configured, process.cwd())).passed).toBe(false);
    step.model.model = 'judge';
    step.visionInput = true;
    expect((await checkAcceptance(input, configured, process.cwd())).passed).toBe(false);
  });
  it('rejects undeclared agent work even when it passed', async () => {
    const input = report();
    input.run.results[0]!.attempts[0]!.steps.push({ api: 'agent.act', status: 'passed' });
    expect((await checkAcceptance(input, policy, process.cwd())).passed).toBe(false);
  });
  it('ignores unselected catalogue entries without ignoring required coverage', async () => {
    const input = report();
    input.run.results.push({ ...input.run.results[0]!, titlePath: ['not selected'], selected: false, status: 'skipped', attempts: [] });
    expect((await checkAcceptance(input, policy, process.cwd())).passed).toBe(true);
    input.run.results[0]!.selected = false;
    input.run.results[0]!.status = 'skipped';
    input.run.results[0]!.attempts = [];
    expect((await checkAcceptance(input, policy, process.cwd())).passed).toBe(false);
  });
  it('checks screenshot bytes, hashes and decoding without trusting an artifact entry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'e2e-acceptance-'));
    const file = path.join(directory, 'frame.png');
    const input = report();
    const required = { ...policy, cases: [{ ...policy.cases[0], screenshots: 1 }] };
    try {
      expect((await checkAcceptance(input, required, directory)).passed).toBe(false);
      const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'white' } }).png().toBuffer();
      await writeFile(file, png);
      const artifact = { id: 'attempt:artifact:0', kind: 'screenshot', mediaType: 'image/png', redaction: 'complete', path: 'frame.png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') };
      input.run.results[0]!.attempts[0]!.artifacts.push(artifact);
      expect((await checkAcceptance(input, required, directory)).passed).toBe(true);
      await writeFile(file, 'not a png');
      expect((await checkAcceptance(input, required, directory)).passed).toBe(false);
      artifact.size = 9;
      artifact.sha256 = createHash('sha256').update('not a png').digest('hex');
      expect((await checkAcceptance(input, required, directory)).passed).toBe(false);
      await writeFile(file, png);
      artifact.size = png.length;
      artifact.sha256 = createHash('sha256').update(png).digest('hex');
      expect((await checkAcceptance(input, required, directory)).passed).toBe(true);
      artifact.path = '../outside.png';
      expect((await checkAcceptance(input, required, directory)).passed).toBe(false);
      artifact.path = file;
      expect((await checkAcceptance(input, required, directory)).passed).toBe(false);
    } finally { await unlink(file).catch(() => {}); await rmdir(directory); }
  });
  it('requires the exact declared negative outcome and live calls, not just a caught error', async () => {
    const input = report();
    const rule = { api: 'agent.assert', status: 'failed', errorCode: 'ASSERTION_FAILED', minCalls: 1, maxCalls: 2 };
    const configured = { ...policy, cases: [{ ...policy.cases[0], steps: [rule] }] };
    const step = { api: 'agent.assert', status: 'failed', error: { code: 'ASSERTION_FAILED' }, metrics: { modelCalls: 1 }, visionInput: false, events: [{ kind: 'model', status: 'passed' }] };
    input.run.results[0]!.attempts[0]!.steps.push(step);
    expect((await checkAcceptance(input, configured, process.cwd())).passed).toBe(true);
    expect((await checkAcceptance(input, policy, process.cwd())).passed).toBe(false);
    expect((await checkAcceptance(input, { ...policy, cases: [{ ...policy.cases[0], steps: [{ ...rule, errorCode: 'ASSERTION_INCONCLUSIVE' }] }] }, process.cwd())).passed).toBe(false);
    expect((await checkAcceptance(report(), configured, process.cwd())).passed).toBe(false);
    step.events[0]!.status = 'failed';
    expect((await checkAcceptance(input, configured, process.cwd())).passed).toBe(false);
    const injected = { ...policy, cases: [{ ...policy.cases[0], steps: [{ ...rule, allowFailedModelRequests: true }] }] };
    expect((await checkAcceptance(input, injected, process.cwd())).passed).toBe(true);
  });
  it('accepts declared coverage but rejects missing repeats, skipped results and retried passes', async () => {
    expect((await checkAcceptance(report(), policy, process.cwd())).passed).toBe(true);
    expect((await checkAcceptance(report(), { ...policy, repeats: 3 }, process.cwd())).passed).toBe(false);
    const skipped = report();
    skipped.run.results[0]!.status = 'skipped';
    expect((await checkAcceptance(skipped, policy, process.cwd())).passed).toBe(false);
    const retried = report();
    retried.run.results[0]!.attempts.push({ ...retried.run.results[0]!.attempts[0]!, id: 'retry' });
    expect((await checkAcceptance(retried, policy, process.cwd())).passed).toBe(false);
    expect((await checkAcceptance(report(), { ...policy, cases: [] }, process.cwd())).passed).toBe(false);
  });
  it('rejects a green report when evidence cleanup failed', async () => {
    const input = report();
    input.run.results[0]!.attempts[0]!.cleanup = 'failed';
    const verdict = await checkAcceptance(input, policy, process.cwd());
    expect(verdict.passed).toBe(false);
    expect(verdict.issues.join(' ')).toContain('cleanup');
  });
});
