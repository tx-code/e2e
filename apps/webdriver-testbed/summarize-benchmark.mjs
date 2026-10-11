import { readFile } from 'node:fs/promises';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass one or more e2e report.json files');
const rows = [];
for (const file of files) {
  const report = JSON.parse(await readFile(file, 'utf8'));
  for (const result of report.run.results) {
    const attempt = result.attempts.at(-1);
    const step = attempt?.steps.find((entry) => entry.api === 'agent.act');
    if (!step) continue;
    const measurements = (attempt.appLog ?? [])
      .filter((entry) => entry.step === step.index && entry.text?.startsWith('webdriver.metrics '))
      .map((entry) => JSON.parse(entry.text.slice('webdriver.metrics '.length)));
    const timing = (operation) => {
      if (measurements.length === 0) return null;
      const matching = measurements.filter((entry) => entry.operation === operation);
      return { count: matching.length, totalMs: Math.round(matching.reduce((sum, entry) => sum + entry.durationMs, 0) * 1000) / 1000 };
    };
    const calls = step.metrics?.modelCalls ?? null;
    rows.push({
      file, runId: report.run.id, repeat: result.repeat, status: result.status,
      cacheMode: step.cache?.mode ?? null, cacheReason: step.cache?.reason ?? null,
      cacheWrite: step.cache?.write ?? null, modelCalls: calls,
      inputTokens: step.model?.inputTokens ?? (calls === 0 ? 0 : null),
      outputTokens: step.model?.outputTokens ?? (calls === 0 ? 0 : null),
      cacheReadTokens: step.model?.cacheReadTokens ?? (calls === 0 ? 0 : null),
      goalMs: step.durationMs, attemptMs: attempt.durationMs,
      observations: timing('observe'), nativeQueries: timing('locate'), referenceResolution: timing('resolveRef'),
    });
  }
}
console.log(JSON.stringify(rows, null, 2));
