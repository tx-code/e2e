import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import edge from 'selenium-webdriver/edge.js';
import { ConfigurationError, EngineError, raceAbort, rejectUnknownKeys } from 'e2e/engine';
import type { WebDriverOptions, WebDriverSession } from './index.ts';

const versionPattern = /^\d+\.\d+\.\d+\.\d+$/;

/** Checks one explicitly registered executable; never searches PATH or downloads a driver. */
export async function preflightEdgeDriver(options: { driverPath: string; runtimeVersion?: string; signal?: AbortSignal }): Promise<{ path: string; version: string; sha256: string }> {
  rejectUnknownKeys('preflightEdgeDriver()', options, ['driverPath', 'runtimeVersion', 'signal']);
  if (typeof options.driverPath !== 'string' || !options.driverPath.trim()) throw new ConfigurationError('INVALID_CONFIG', 'Set an explicit driverPath or WEBDRIVER_EDGE_DRIVER; automatic driver discovery is disabled');
  if (options.runtimeVersion !== undefined && !versionPattern.test(options.runtimeVersion)) throw new ConfigurationError('INVALID_CONFIG', 'runtimeVersion must be a four-part version');
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(5000)]);
  try {
    return await raceAbort(async () => {
      signal.throwIfAborted();
      const executable = await realpath(path.resolve(options.driverPath));
      if (!(await stat(executable)).isFile()) throw new Error('Driver path is not a file');
      signal.throwIfAborted();
      const output = await new Promise<string>((resolve, reject) => {
        execFile(executable, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 65536, signal }, (error, stdout) => error ? reject(error) : resolve(stdout));
      });
      const version = /^(?:Microsoft Edge WebDriver|MSEdgeDriver)\s+(\d+\.\d+\.\d+\.\d+)/.exec(output.trim())?.[1];
      if (!version) throw new Error('Executable did not identify itself as Microsoft Edge WebDriver');
      if (options.runtimeVersion && version.split('.').slice(0, 3).join('.') !== options.runtimeVersion.split('.').slice(0, 3).join('.')) throw new Error(`Driver ${version} does not match runtime ${options.runtimeVersion}`);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(executable, { signal })) hash.update(chunk);
      return { path: executable, version, sha256: hash.digest('hex') };
    }, signal, 'Edge driver preflight');
  } catch (cause) {
    throw new EngineError(options.signal?.aborted ? 'CANCELLED' : signal.aborted ? 'OPERATION_TIMEOUT' : 'ENGINE_FAILURE', 'Edge setup failed at driver preflight; verify executable path and runtime compatibility', { retryable: false, cause });
  }
}

/** Creates an owned local Edge session with explicit driver selection and bounded startup/cleanup. */
export function edgeSession(options: { driverPath?: string; browserPath?: string; runtimeVersion?: string; startupTimeoutMs?: number } = {}): WebDriverOptions['createSession'] {
  rejectUnknownKeys('edgeSession()', options, ['driverPath', 'browserPath', 'runtimeVersion', 'startupTimeoutMs']);
  const timeoutMs = options.startupTimeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw new ConfigurationError('INVALID_CONFIG', 'startupTimeoutMs must be between 1 and 120000');
  if (options.browserPath !== undefined && (typeof options.browserPath !== 'string' || !options.browserPath.trim())) throw new ConfigurationError('INVALID_CONFIG', 'browserPath must be a nonempty executable path');
  return async (info, attempt) => {
    const signal = AbortSignal.any([attempt.signal, AbortSignal.timeout(timeoutMs)]);
    const configured = options.driverPath ?? info.env['WEBDRIVER_EDGE_DRIVER'];
    if (!configured?.trim()) throw new ConfigurationError('INVALID_CONFIG', 'Set WEBDRIVER_EDGE_DRIVER or edgeSession({ driverPath }); automatic driver discovery is disabled');
    let driverInfo: Awaited<ReturnType<typeof preflightEdgeDriver>>;
    try { driverInfo = await preflightEdgeDriver({ driverPath: path.resolve(info.projectRoot, configured), ...(options.runtimeVersion === undefined ? {} : { runtimeVersion: options.runtimeVersion }), signal }); }
    catch (cause) {
      if (!attempt.signal.aborted && signal.aborted) throw new EngineError('OPERATION_TIMEOUT', 'Edge setup deadline expired during driver preflight', { retryable: false, cause });
      throw cause;
    }
    const browserOptions = new edge.Options();
    if (!info.headed) browserOptions.addArguments('--headless=new');
    browserOptions.addArguments('--no-first-run');
    if (options.browserPath) {
      const browserPath = await realpath(path.resolve(info.projectRoot, options.browserPath));
      if (!(await stat(browserPath)).isFile()) throw new ConfigurationError('INVALID_CONFIG', 'browserPath is not a file');
      browserOptions.setEdgeChromiumBinaryPath(browserPath);
    }
    const service = new edge.ServiceBuilder(driverInfo.path).build();
    let driver: edge.Driver | undefined;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= (async () => {
      let failure: unknown;
      try { if (driver) await raceAbort(driver.quit(), AbortSignal.timeout(5000), 'Edge session close'); }
      catch (cause) { failure = cause; }
      try { await raceAbort(service.kill(), AbortSignal.timeout(5000), 'Edge driver close'); }
      catch (cause) { failure = failure ? new AggregateError([failure, cause]) : cause; }
      if (failure) throw new EngineError('ENGINE_FAILURE', 'Edge setup cleanup could not be confirmed', { retryable: false, cause: failure });
    })();
    let stage = 'driver startup';
    try {
      signal.throwIfAborted();
      await raceAbort(service.start(timeoutMs), signal, stage);
      signal.throwIfAborted();
      stage = 'browser session';
      driver = edge.Driver.createSession(browserOptions, service);
      await raceAbort(driver.getSession(), signal, stage);
      stage = 'runtime verification';
      const capabilities = await raceAbort(driver.getCapabilities(), signal, stage);
      const runtimeVersion = String(capabilities.get('browserVersion') ?? '');
      if (!versionPattern.test(runtimeVersion) || runtimeVersion.split('.').slice(0, 3).join('.') !== driverInfo.version.split('.').slice(0, 3).join('.')) throw new Error('Session runtime does not match the explicit driver');
      signal.throwIfAborted();
      attempt.environment({ driverVersion: driverInfo.version, driverSha256: driverInfo.sha256, runtimeVersion });
      return { driver, close } satisfies WebDriverSession;
    } catch (cause) {
      let failure = cause;
      try { await close(); } catch (cleanup) { failure = new AggregateError([cause, cleanup]); }
      throw new EngineError(attempt.signal.aborted ? 'CANCELLED' : signal.aborted ? 'OPERATION_TIMEOUT' : 'ENGINE_FAILURE', `Edge setup failed at ${stage}; no fallback driver was used`, { retryable: false, cause: failure });
    }
  };
}
