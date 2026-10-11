import { describe, expect, it, vi } from 'vitest';
import { webdriver } from '../src/index.ts';
import { EngineError } from 'e2e/engine';
import type { EngineInitInfo, EngineAttemptContext, OperationContext } from 'e2e/engine';
import { error as seleniumError, type WebDriver } from 'selenium-webdriver';

const operation = (): OperationContext => ({ signal: new AbortController().signal, timeoutMs: 1000, runId: 'run', attemptId: 'attempt', origin: 'test' });
const info = (): EngineInitInfo => ({ runId: 'run', targetName: 'test', projectRoot: process.cwd(), app: {}, env: {}, headed: false, workerSlot: 0, signal: new AbortController().signal, log() {} });
const attempt = (signal = new AbortController().signal): EngineAttemptContext => ({
  attemptId: 'attempt', artifactsDir: process.cwd(), signal,
  resolveSecret: async () => { throw new Error('not used'); }, appLog() {}, navigation() {}, environment() {},
});

describe('session ownership', () => {
  it('requires explicit video configuration and a masked screenshot provider', () => {
    const createSession = async () => { throw new Error('not started'); };
    expect(() => webdriver({ createSession, video: {} })).toThrow('screenshot');
    expect(() => webdriver({ createSession, screenshot: async () => new Uint8Array(), video: { fps: 0 } })).toThrow('fps');
    const screenshots = webdriver({ createSession, screenshot: async () => new Uint8Array() });
    expect(screenshots.artifacts?.startVideo).toBeUndefined();
    const recording = webdriver({ createSession, screenshot: async () => new Uint8Array(), video: {} });
    expect(recording.artifacts?.startVideo).toBeTypeOf('function');
    expect(recording.artifacts?.stopVideo).toBeTypeOf('function');
  });
  it('releases each claimed session exactly once, including repeated cleanup', async () => {
    const close = vi.fn(async () => {});
    const driver = { manage: () => ({ setTimeouts: async () => {} }) } as unknown as WebDriver;
    const createSession = vi.fn(async () => ({ driver, close }));
    const engine = webdriver({ createSession });
    await engine.init!(info());
    await engine.startAttempt!(attempt());
    await engine.endAttempt!({ signal: new AbortController().signal, timeoutMs: 1000 });
    await engine.dispose!({ signal: new AbortController().signal, timeoutMs: 1000 });
    expect(close).toHaveBeenCalledTimes(1);
    await engine.startAttempt!(attempt());
    await engine.endAttempt!({ signal: new AbortController().signal, timeoutMs: 1000 });
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('releases a session that arrives after the attempt was cancelled', async () => {
    const controller = new AbortController();
    const close = vi.fn(async () => {});
    const engine = webdriver({ createSession: async () => { controller.abort(); return { driver: {} as WebDriver, close }; } });
    await engine.init!(info());
    await expect(engine.startAttempt!(attempt(controller.signal))).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not advertise navigation, frames or unmasked screenshots by default', async () => {
    const engine = webdriver({ createSession: async () => { throw new Error('not started'); } });
    expect(engine.session).toBeUndefined();
    expect(engine.artifacts).toBeUndefined();
    await expect(engine.locate!({ kind: 'frame', selector: 'iframe', source: { kind: 'selector', selector: 'button' } }, operation())).rejects.toBeInstanceOf(EngineError);
  });

  it('reports an exhausted read budget as a timeout, not a user cancellation', async () => {
    const driver = {
      manage: () => ({ setTimeouts: async () => {} }),
      executeScript: () => new Promise(() => {}),
    } as unknown as WebDriver;
    const engine = webdriver({ createSession: async () => ({ driver, close: async () => {} }) });
    await engine.init!(info());
    await engine.startAttempt!(attempt());
    await expect(engine.observe!({ ...operation(), timeoutMs: 5 })).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await engine.dispose!({ signal: new AbortController().signal, timeoutMs: 1000 });
  });

  it('never retries an input whose connection was lost after dispatch', async () => {
    const click = vi.fn(async () => { throw new seleniumError.NoSuchSessionError('connection dropped'); });
    const driver = {
      manage: () => ({ setTimeouts: async () => {} }),
      executeScript: async () => ({ click }),
    } as unknown as WebDriver;
    const engine = webdriver({ createSession: async () => ({ driver, close: async () => {} }) });
    await engine.init!(info());
    await engine.startAttempt!(attempt());
    await expect(engine.perform!({ id: 'element', revision: '' }, { kind: 'tap' }, operation())).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
    expect(click).toHaveBeenCalledTimes(1);
    await engine.dispose!({ signal: new AbortController().signal, timeoutMs: 1000 });
  });
});
