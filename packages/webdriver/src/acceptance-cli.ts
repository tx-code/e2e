#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkAcceptance } from './acceptance.ts';

const [reportFile, policyFile, ...extra] = process.argv.slice(2);
if (!reportFile || !policyFile || extra.length) {
  console.error('Usage: e2e-acceptance <report.json> <policy.json>');
  process.exitCode = 2;
} else {
  try {
    const report = JSON.parse(await readFile(reportFile, 'utf8')) as unknown;
    const policy = JSON.parse(await readFile(policyFile, 'utf8')) as unknown;
    const result = await checkAcceptance(report, policy, path.join(path.dirname(path.resolve(reportFile)), 'results'));
    console.log(`Report acceptance: ${result.passed ? 'PASS' : 'NOT PASSED'}`);
    for (const issue of result.issues) console.log(`- ${issue}`);
    console.log('Scope: declared report coverage, attempts, steps, model provenance and local PNG integrity. This does not prove application isolation, video decoding or business-file correctness.');
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(`Acceptance input could not be read: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 2;
  }
}
