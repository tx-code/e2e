#!/usr/bin/env node
import { preflightEdgeDriver } from './edge.ts';

const [driverPath = process.env['WEBDRIVER_EDGE_DRIVER'], runtimeVersion, ...extra] = process.argv.slice(2);
if (!driverPath || extra.length) {
  console.error('Usage: e2e-webdriver-doctor [driver-executable] [runtime-version]\nOr set WEBDRIVER_EDGE_DRIVER. No PATH discovery or download is performed.');
  process.exitCode = 2;
} else {
  try {
    const result = await preflightEdgeDriver({ driverPath, ...(runtimeVersion === undefined ? {} : { runtimeVersion }) });
    console.log(`Driver preflight: PASS\nExecutable: ${result.path}\nVersion: ${result.version}\nSHA-256: ${result.sha256}`);
    console.log('This verifies the driver executable, not browser launch, application readiness, login or isolation.');
  } catch (error) {
    console.error(`Driver preflight: FAILED\n${error instanceof Error ? error.message : 'Unknown failure'}`);
    if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message);
    process.exitCode = 1;
  }
}
