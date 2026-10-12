import { z } from 'zod';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const ruleSchema = z.object({ api: z.string().min(1), status: z.enum(['passed', 'failed']), errorCode: z.string().optional(), minCalls: z.number().int().nonnegative().optional(), maxCalls: z.number().int().nonnegative().optional(), allowFailedModelRequests: z.boolean().optional() }).strict();
const policySchema = z.object({ repeats: z.number().int().min(1).max(100), model: z.object({ provider: z.string(), model: z.string() }).strict().optional(), cases: z.array(z.object({
  file: z.string().min(1), title: z.string().min(1), target: z.string().min(1), screenshots: z.number().int().nonnegative(), steps: z.array(ruleSchema),
}).strict()).min(1) }).strict();
const stepSchema = z.object({ api: z.string(), status: z.string(), error: z.object({ code: z.string() }).optional(), metrics: z.object({ modelCalls: z.number().int().nonnegative() }).passthrough().optional(), events: z.array(z.object({ kind: z.string(), status: z.string() }).passthrough()).optional(), visionInput: z.boolean().optional(), model: z.object({ provider: z.string(), model: z.string() }).passthrough().optional() }).passthrough();
const artifactSchema = z.object({ id: z.string(), kind: z.string(), mediaType: z.string(), redaction: z.string(), path: z.string().optional(), size: z.number().int().nonnegative().optional(), sha256: z.string().optional() });

const reportSchema = z.object({ schemaVersion: z.literal('report-1'), run: z.object({
  id: z.string().min(1), status: z.string(), exitCode: z.number().int(), errors: z.array(z.unknown()),
  serialGroups: z.array(z.unknown()),
  results: z.array(z.object({
    file: z.string(), titlePath: z.array(z.string()), targetId: z.string(), repeat: z.number().int().nonnegative(), selected: z.boolean(), status: z.string(),
    attempts: z.array(z.object({ id: z.string(), status: z.string(), cleanup: z.string(), secondaryErrors: z.array(z.unknown()), steps: z.array(stepSchema), artifacts: z.array(artifactSchema) })),
  })),
}) });

export interface AcceptanceResult { readonly passed: boolean; readonly issues: readonly string[] }

/** Checks report evidence without rewriting the runner's original verdict. */
export async function checkAcceptance(input: unknown, policyInput: unknown, artifactsRoot: string): Promise<AcceptanceResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { passed: false, issues: ['Invalid report-1 structure'] };
  const issues: string[] = [];
  const policy = policySchema.safeParse(policyInput);
  if (!policy.success) return { passed: false, issues: ['Invalid acceptance policy'] };
  const run = parsed.data.run;
  if (run.status !== 'passed' || run.exitCode !== 0 || run.errors.length) issues.push('Run did not pass cleanly');
  if (run.serialGroups.length) issues.push('Serial groups are not supported by this gate');
  const key = (file: string, title: string, target: string) => JSON.stringify([file.replaceAll('\\', '/'), title, target]);
  const declared = new Set<string>();
  const artifactFiles = new Set<string>();
  for (const expected of policy.data.cases) {
    const identity = key(expected.file, expected.title, expected.target);
    if (declared.has(identity)) issues.push(`Duplicate policy case: ${expected.title}`);
    declared.add(identity);
    const results = run.results.filter((result) => key(result.file, result.titlePath.join(' > '), result.targetId) === identity);
    if (results.length !== policy.data.repeats || new Set(results.map((result) => result.repeat)).size !== policy.data.repeats || results.some((result) => result.repeat >= policy.data.repeats)) issues.push(`${expected.title}: missing or duplicate repeats`);
    for (const result of results) for (const attempt of result.attempts) {
      const seen = new Set<string>();
      for (const rule of expected.steps) {
        if (seen.has(rule.api)) issues.push(`${expected.title}: duplicate step rule`);
        seen.add(rule.api);
        const steps = attempt.steps.filter((step) => step.api === rule.api);
        if (steps.length !== 1) { issues.push(`${expected.title}: expected exactly one ${rule.api}`); continue; }
        const step = steps[0]!;
        if (step.status !== rule.status || step.error?.code !== rule.errorCode || (rule.status === 'failed' && !rule.errorCode)) issues.push(`${expected.title}: unexpected ${rule.api} outcome`);
        if (rule.minCalls !== undefined && (step.metrics?.modelCalls === undefined || step.metrics.modelCalls < rule.minCalls)) issues.push(`${expected.title}: missing live model calls`);
        if (rule.minCalls !== undefined) {
          const calls = step.events?.filter((event) => event.kind === 'model') ?? [];
          if (calls.length < rule.minCalls || (!rule.allowFailedModelRequests && calls.some((event) => event.status !== 'passed'))) issues.push(`${expected.title}: model request did not complete successfully`);
        }
        if (rule.maxCalls !== undefined && (step.metrics?.modelCalls === undefined || step.metrics.modelCalls > rule.maxCalls)) issues.push(`${expected.title}: model call budget exceeded`);
      }
      for (const step of attempt.steps) {
        if (step.api.startsWith('agent.') && !seen.has(step.api)) issues.push(`${expected.title}: undeclared agent step ${step.api}`);
        if (step.status !== 'passed' && !expected.steps.some((rule) => rule.api === step.api && rule.status === 'failed' && rule.errorCode === step.error?.code)) issues.push(`${expected.title}: unexpected failed step ${step.api}`);
        if (step.visionInput === true) issues.push(`${expected.title}: model vision was not permitted`);
        if (step.api.startsWith('agent.') && policy.data.model && (step.model?.provider !== policy.data.model.provider || step.model.model !== policy.data.model.model)) issues.push(`${expected.title}: unexpected or missing model provenance`);
      }
      const screenshots = attempt.artifacts.filter((artifact) => artifact.kind === 'screenshot');
      if (screenshots.length < expected.screenshots) issues.push(`${expected.title}: required screenshots missing`);
      for (const artifact of screenshots) {
        try {
          if (!artifact.path || path.isAbsolute(artifact.path) || path.win32.isAbsolute(artifact.path) || artifact.path.replaceAll('\\', '/').split('/').includes('..')) throw new Error('Unsafe screenshot path');
          if (artifact.mediaType !== 'image/png' || artifact.redaction !== 'complete' || !artifact.id.startsWith(`${attempt.id}:artifact:`)) throw new Error('Screenshot provenance or masking missing');
          const root = await realpath(artifactsRoot);
          const file = await realpath(path.join(root, artifact.path));
          const relative = path.relative(root, file);
          if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Screenshot escapes artifact root');
          if (artifactFiles.has(file)) throw new Error('Screenshot reused across artifacts');
          artifactFiles.add(file);
          const metadata = await stat(file);
          if (!metadata.isFile() || metadata.size > 20_000_000 || metadata.size !== artifact.size) throw new Error('Screenshot size mismatch or missing');
          const bytes = await readFile(file);
          if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Screenshot digest mismatch or missing');
          const decoder = sharp(bytes, { limitInputPixels: 25_000_000, failOn: 'warning' });
          if ((await decoder.metadata()).format !== 'png') throw new Error('Screenshot is not PNG');
          await decoder.raw().toBuffer();
        } catch { issues.push(`${expected.title}: screenshot is missing, invalid, outside scope or lacks integrity metadata`); }
      }
    }
  }
  for (const result of run.results) {
    const required = declared.has(key(result.file, result.titlePath.join(' > '), result.targetId));
    if (!required && !result.selected && result.status === 'skipped' && result.attempts.length === 0) continue;
    if (!required) issues.push(`Undeclared case: ${result.titlePath.join(' > ')}`);
    if (!result.selected || result.status !== 'passed' || result.attempts.length !== 1 || result.attempts[0]?.status !== 'passed') issues.push(`${result.titlePath.join(' > ')}: nonpassing, skipped or retried result`);
  }
  for (const result of run.results) for (const attempt of result.attempts) {
    if (attempt.cleanup !== 'complete' || attempt.secondaryErrors.length) issues.push(`${result.titlePath.join(' > ')}: cleanup or secondary errors`);
  }
  return { passed: issues.length === 0, issues };
}
