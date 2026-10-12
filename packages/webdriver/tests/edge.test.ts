import { describe, it, expect } from 'vitest';
import { preflightEdgeDriver, edgeSession } from '../src/edge.ts';
import type { EngineInitInfo, EngineAttemptContext } from 'e2e/engine';

describe('explicit Edge setup', () => {
  it('rejects non-driver executables and invalid setup parameters', async () => {
    await expect(preflightEdgeDriver({ driverPath: process.execPath })).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    await expect(preflightEdgeDriver({ driverPath: process.cwd() })).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    await expect(preflightEdgeDriver({ driverPath: process.execPath, runtimeVersion: 'latest' })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(() => edgeSession({ startupTimeoutMs: 0 })).toThrow();
  });
  it('distinguishes startup deadline from user cancellation', async () => {
    const info = { projectRoot: process.cwd(), env: {} } as EngineInitInfo;
    await expect(edgeSession({ driverPath: process.execPath, startupTimeoutMs: 1 })(info, { signal: new AbortController().signal } as EngineAttemptContext)).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(preflightEdgeDriver({ driverPath: process.execPath, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('refuses missing explicit drivers rather than invoking automatic discovery', async () => {
    await expect(preflightEdgeDriver({ driverPath: '' })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    const info = { projectRoot: process.cwd(), env: {} } as EngineInitInfo;
    const attempt = { signal: new AbortController().signal } as EngineAttemptContext;
    await expect(edgeSession()(info, attempt)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
