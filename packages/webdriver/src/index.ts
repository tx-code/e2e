import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { By, Key, error as seleniumError, type WebDriver, type WebElement } from 'selenium-webdriver';
import {
  ConfigurationError, EngineError, defineEngine, parseKey, raceAbort, rejectUnknownKeys, resolveExpression,
  type EngineHandle, type EngineInitInfo, type EngineAttemptContext,
  type EngineSnapshot, type LocatorAction, type LocatorExpression, type NodeRef,
  type OperationContext, type SemanticNode,
} from 'e2e/engine';
import { captureDocument, elementByRef, type DomCapture } from './dom.ts';
import { PageVideoRecorder } from './video.ts';
import type { Locator } from 'e2e';
import { test as base, describe, beforeEach, afterEach, beforeAll, afterAll, expect } from 'e2e';

export { describe, beforeEach, afterEach, beforeAll, afterAll, expect };

export interface WebDriverSession {
  readonly driver: WebDriver;
  /** Called once to release this attempt's driver and any host it owns. */
  readonly close: () => Promise<void>;
}

export interface WebDriverOptions {
  /** Creates a session in the worker for each attempt. Honor the supplied abort signal. */
  readonly createSession: (info: EngineInitInfo, attempt: EngineAttemptContext) => Promise<WebDriverSession>;
  /** Existing documents remain untouched; navigation is available only when explicitly enabled. */
  readonly navigation?: boolean;
  readonly testIdAttribute?: string;
  readonly workers?: number;
  /** Records operation timing only, without document content, in the local e2e trace. */
  readonly metrics?: boolean;
  /** Returns source-masked PNG bytes. Omit when the host cannot prove masking. */
  readonly screenshot?: (session: WebDriverSession, context: OperationContext) => Promise<Uint8Array>;
  /** Page-only sampled MP4. Requires a source-masked screenshot provider and FFmpeg with libx264. */
  readonly video?: { readonly ffmpegPath?: string; readonly fps?: number };
}

export interface WebDriverFixture {
  locator(selector: string): Locator;
  /** Trusted test code only. UI actions should use locators so e2e records them. */
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
}

export const test = base.extend<{ webdriver: WebDriverFixture }>();

/** Creates a WebDriver engine using only the public e2e engine contract. */
export function webdriver(options: WebDriverOptions): EngineHandle {
  rejectUnknownKeys('webdriver()', options, ['createSession', 'navigation', 'testIdAttribute', 'workers', 'metrics', 'screenshot', 'video']);
  if (typeof options.createSession !== 'function') throw new ConfigurationError('INVALID_CONFIG', 'webdriver() requires createSession');
  if (options.navigation !== undefined && typeof options.navigation !== 'boolean') throw new ConfigurationError('INVALID_CONFIG', 'webdriver() navigation must be boolean');
  if (options.metrics !== undefined && typeof options.metrics !== 'boolean') throw new ConfigurationError('INVALID_CONFIG', 'webdriver() metrics must be boolean');
  if (options.testIdAttribute !== undefined && (typeof options.testIdAttribute !== 'string' || !options.testIdAttribute.trim())) throw new ConfigurationError('INVALID_CONFIG', 'webdriver() testIdAttribute must be a nonempty string');
  if (options.screenshot !== undefined && typeof options.screenshot !== 'function') throw new ConfigurationError('INVALID_CONFIG', 'webdriver() screenshot must be a source-masked PNG callback');
  if (options.video !== undefined) {
    if (!options.video || typeof options.video !== 'object' || Array.isArray(options.video) || !options.screenshot) throw new ConfigurationError('INVALID_CONFIG', 'WebDriver video requires options and a source-masked screenshot provider');
    rejectUnknownKeys('webdriver().video', options.video, ['ffmpegPath', 'fps']);
    if (options.video.fps !== undefined && (!Number.isFinite(options.video.fps) || options.video.fps < 1 || options.video.fps > 5)) throw new ConfigurationError('INVALID_CONFIG', 'Video fps must be between 1 and 5');
    if (options.video.ffmpegPath !== undefined && (typeof options.video.ffmpegPath !== 'string' || !options.video.ffmpegPath.trim())) throw new ConfigurationError('INVALID_CONFIG', 'Video ffmpegPath must be a nonempty executable path');
  }
  const surface = new WebDriverSurface(options);
  const require = createRequire(import.meta.url);
  const { version } = require('../package.json') as { version: string };
  return defineEngine({
    name: 'webdriver', version, spiVersion: 1, platform: 'web', workers: options.workers ?? 1,
    init: async (info) => { surface.info = info; },
    startAttempt: (context) => surface.start(context),
    endAttempt: () => surface.close(),
    dispose: () => surface.close(),
    observe: (context) => surface.observe(context),
    locate: (expression, context) => surface.locate(expression, context),
    perform: (ref, action, context) => surface.perform(ref, action, context),
    actions: ['tap', 'doubleTap', 'secondaryTap', 'fill', 'clear', 'press', 'check', 'uncheck', 'selectOption', 'focus', 'hover', 'scrollIntoView'],
    ...(options.navigation === true ? { session: {
      open: (url: string, context: OperationContext) => surface.command(context, () => surface.driver().get(url), true),
      back: (context: OperationContext) => surface.command(context, () => surface.driver().navigate().back(), true),
    } } : {}),
    ...(options.screenshot === undefined ? {} : { artifacts: {
      screenshot: (label, context) => surface.screenshot(label, context),
      ...(options.video === undefined ? {} : { startVideo: (context: OperationContext) => surface.startVideo(context), stopVideo: (context: OperationContext) => surface.stopVideo(context) }),
    } }),
    fixtures: { webdriver: (context) => context.fixture<WebDriverFixture>('webdriver', {
      locator: (selector) => context.locator({ kind: 'selector', selector }),
      evaluate: <T, A = undefined>(fn: (arg: A) => T, arg?: A) => surface.command(context.operation(), () => surface.driver().executeScript<T>(fn, arg)),
    }, { evaluate: { kind: 'resource', label: () => 'evaluate' } }) },
  });
}

/** Owns the per-attempt transport without replacing its host document. */
class WebDriverSurface {
  info: EngineInitInfo | undefined;
  private session: WebDriverSession | undefined;
  private attempt: EngineAttemptContext | undefined;
  private artifactIndex = 0;
  private recorder: PageVideoRecorder | undefined;
  private closing: Promise<void> | undefined;
  private cleanupFailure: unknown;

  constructor(private readonly options: WebDriverOptions) {}

  /** Claims a newly created session or releases one that arrived after cancellation. */
  async start(attempt: EngineAttemptContext): Promise<void> {
    if (!this.info) throw new EngineError('INVALID_STATE', 'WebDriver engine is not initialized', { retryable: false });
    await this.close();
    if (attempt.signal.aborted) throw new EngineError('CANCELLED', 'WebDriver setup cancelled before session creation', { retryable: false });
    this.attempt = attempt;
    this.artifactIndex = 0;
    const session = await this.options.createSession(this.info, attempt);
    if (attempt.signal.aborted || this.attempt !== attempt) {
      await session.close();
      throw new EngineError('CANCELLED', 'WebDriver session arrived after the attempt ended', { retryable: false });
    }
    this.session = session;
    try {
      await raceAbort(session.driver.manage().setTimeouts({ implicit: 0 }), attempt.signal, 'WebDriver initialization');
      if (attempt.signal.aborted || this.attempt !== attempt || this.session !== session) throw new EngineError('CANCELLED', 'WebDriver setup ended before initialization completed', { retryable: false });
    } catch (cause) {
      try { if (this.session === session) await this.close(); }
      catch (cleanup) {
        throw new EngineError('ENGINE_FAILURE', 'WebDriver initialization and cleanup both failed', { retryable: false, cause: new AggregateError([cause, cleanup]) });
      }
      if (attempt.signal.aborted) throw new EngineError('CANCELLED', 'WebDriver setup cancelled during initialization', { retryable: false, cause });
      throw cause;
    }
  }

  /** Releases only resources claimed by this attempt, also after a partial start. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.cleanupFailure !== undefined) return Promise.reject(new EngineError('ENGINE_FAILURE', 'Previous WebDriver cleanup failed; this engine cannot be reused', { retryable: false, cause: this.cleanupFailure }));
    const recorder = this.recorder;
    this.recorder = undefined;
    const session = this.session;
    this.session = undefined;
    this.attempt = undefined;
    this.closing = (async () => {
      const failures: unknown[] = [];
      try { await recorder?.dispose(); } catch (cause) { failures.push(cause); }
      try { await session?.close(); } catch (cause) { failures.push(cause); }
      if (failures.length) {
        this.cleanupFailure = new AggregateError(failures);
        throw new EngineError('ENGINE_FAILURE', 'WebDriver cleanup failed; this engine cannot be reused', { retryable: false, cause: this.cleanupFailure });
      }
    })().finally(() => { this.closing = undefined; });
    return this.closing;
  }

  /** Refuses use outside an active attempt. */
  driver(): WebDriver {
    if (!this.session) throw new EngineError('INVALID_STATE', 'No active WebDriver session', { retryable: false });
    return this.session.driver;
  }

  /** Starts an opt-in page-only sampler, deferring blank startup pages. */
  async startVideo(context: OperationContext): Promise<void> {
    if (!this.session || !this.attempt || !this.options.video || !this.options.screenshot) throw new EngineError('UNSUPPORTED_CAPABILITY', 'No active page video provider', { retryable: false });
    if (this.recorder) throw new EngineError('INVALID_STATE', 'Page recording is already active', { retryable: false });
    const session = this.session;
    const recorder = new PageVideoRecorder({
      artifactsDir: this.attempt.artifactsDir,
      executable: this.options.video.ffmpegPath ?? 'ffmpeg', fps: this.options.video.fps ?? 2,
      capture: (signal) => this.command({ ...context, signal, timeoutMs: 3000 }, async () => {
        if (this.session !== session) throw new EngineError('INVALID_STATE', 'Recording session changed', { retryable: false });
        const url = await session.driver.getCurrentUrl();
        if (url === 'about:blank' || url === 'data:,') return undefined;
        return this.options.screenshot!(session, { ...context, signal, timeoutMs: 3000 });
      }),
    });
    this.recorder = recorder;
    try { await recorder.start(context.signal); }
    catch (error) { await recorder.dispose(); this.recorder = undefined; throw error; }
  }

  /** Encodes and returns video through the runner's existing artifact contract. */
  async stopVideo(context: OperationContext) {
    const recorder = this.recorder;
    if (!recorder) return [];
    try { return await recorder.stop(AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, context.timeoutMs))])); }
    finally { this.recorder = undefined; }
  }

  /** One bounded operation; a lost write response is never retried as a read failure. */
  async command<T>(context: OperationContext, work: () => Promise<T>, mutation = false): Promise<T> {
    if (context.signal.aborted) throw new EngineError('CANCELLED', 'WebDriver operation cancelled before dispatch', { retryable: false });
    if (context.timeoutMs <= 0) throw new EngineError('OPERATION_TIMEOUT', 'WebDriver operation has no budget left', { retryable: false });
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, context.timeoutMs))]);
    try {
      return await raceAbort(work(), signal, 'WebDriver operation');
    } catch (cause) {
      if (cause instanceof ConfigurationError) throw cause;
      if (signal.aborted && !context.signal.aborted) throw new EngineError(mutation ? 'ACTION_MAY_HAVE_COMMITTED' : 'OPERATION_TIMEOUT', mutation ? 'WebDriver input exceeded its budget after dispatch; verify state before retrying' : 'WebDriver read exceeded its operation budget', { retryable: false, cause });
      if (cause instanceof EngineError && (!mutation || ['UNSUPPORTED_CAPABILITY', 'INVALID_ARGUMENT', 'NODE_STALE', 'NOT_ACTIONABLE'].includes(cause.code))) throw cause;
      if (cause instanceof seleniumError.StaleElementReferenceError) throw new EngineError('NODE_STALE', 'The document element was replaced', { retryable: true, cause });
      if (cause instanceof seleniumError.ElementClickInterceptedError || cause instanceof seleniumError.ElementNotInteractableError) throw new EngineError('NOT_ACTIONABLE', 'The element cannot receive input', { retryable: false, cause });
      throw new EngineError(mutation ? 'ACTION_MAY_HAVE_COMMITTED' : signal.aborted ? 'OPERATION_TIMEOUT' : 'ENGINE_FAILURE', mutation ? 'WebDriver input may have reached the app; verify state before retrying' : 'WebDriver command failed', { retryable: false, cause });
    }
  }

  /** Captures one main-document tree and all native selector matches in the same read. */
  private capture(context: OperationContext, selectors: string[] = []): Promise<DomCapture> {
    return this.command(context, () => this.driver().executeScript<DomCapture>(captureDocument, selectors, this.options.testIdAttribute ?? 'data-testid', 10_000));
  }

  /** Provides semantic observations without unmasked model pixels. */
  async observe(context: OperationContext): Promise<EngineSnapshot> {
    const started = performance.now();
    const capture = await this.capture(context);
    this.metric('observe', performance.now() - started);
    return { root: capture.root, viewport: capture.viewport, location: capture.location, truncated: capture.truncated };
  }

  /** Resolves once. The runner owns polling, strict matching, and assertions. */
  async locate(expression: LocatorExpression, context: OperationContext): Promise<SemanticNode[]> {
    const started = performance.now();
    const selectors = new Set<string>();
    const visit = (node: LocatorExpression): void => {
      if (node.kind === 'selector') selectors.add(node.selector);
      else if (node.kind === 'query' && node.scope) visit(node.scope);
      else if (node.kind === 'index') visit(node.source);
      else if (node.kind === 'filter') { visit(node.source); if (node.has) visit(node.has); }
      else if (node.kind === 'frame') throw new EngineError('UNSUPPORTED_CAPABILITY', 'WebDriver frame queries are not implemented', { retryable: false });
    };
    visit(expression);
    const capture = await this.capture(context, [...selectors]);
    if (capture.truncated) throw new EngineError('ENGINE_FAILURE', 'Document exceeds the WebDriver capture budget', { retryable: false });
    const result = resolveExpression(expression, [capture.root], { selector: (selector, candidates) => {
      const matches = new Set(capture.matched[selector] ?? []);
      return candidates.filter((node) => matches.has(node.ref.id));
    } });
    this.metric('locate', performance.now() - started);
    return result;
  }

  /** Maps a semantic reference back to a WebDriver element before dispatch. */
  private async element(ref: NodeRef, context: OperationContext): Promise<WebElement> {
    const started = performance.now();
    const element = await this.command(context, () => this.driver().executeScript<WebElement | null>(elementByRef, ref.id));
    if (element === null) throw new EngineError('NODE_STALE', 'Element reference no longer binds to this document', { retryable: true });
    this.metric('resolveRef', performance.now() - started);
    return element;
  }

  /** Records timing only when the host explicitly enables local measurements. */
  private metric(operation: string, durationMs: number): void {
    if (this.options.metrics) this.attempt?.appLog({ source: 'system', level: 'info', text: `webdriver.metrics ${JSON.stringify({ operation, durationMs: Math.round(durationMs * 1000) / 1000 })}` });
  }

  /** Dispatches native WebDriver input; document scripts never simulate clicks or fills. */
  async perform(ref: NodeRef, action: LocatorAction, context: OperationContext): Promise<void> {
    const element = await this.element(ref, context);
    await this.command(context, async () => {
      const driver = this.driver();
      await driver.manage().setTimeouts({ pageLoad: context.timeoutMs, script: context.timeoutMs });
      switch (action.kind) {
        case 'tap': await element.click(); return;
        case 'doubleTap': await driver.actions({ async: true }).doubleClick(element).perform(); return;
        case 'secondaryTap': await driver.actions({ async: true }).contextClick(element).perform(); return;
        case 'fill': await element.clear(); await element.sendKeys(action.value); return;
        case 'clear': await element.clear(); return;
        case 'press': {
          const parsed = parseKey(action.key);
          if (!parsed) throw new ConfigurationError('INVALID_ARGUMENT', 'Invalid WebDriver key');
          const modifiers = parsed.modifiers.map((modifier) => modifier === 'ControlOrMeta' ? process.platform === 'darwin' ? Key.COMMAND : Key.CONTROL : ({ Control: Key.CONTROL, Shift: Key.SHIFT, Alt: Key.ALT, Meta: Key.COMMAND })[modifier]);
          const key = parsed.key.kind === 'char' ? parsed.key.char :
            ({ Enter: Key.ENTER, Escape: Key.ESCAPE, Tab: Key.TAB, Backspace: Key.BACK_SPACE, Delete: Key.DELETE, ArrowUp: Key.ARROW_UP, ArrowDown: Key.ARROW_DOWN, ArrowLeft: Key.ARROW_LEFT, ArrowRight: Key.ARROW_RIGHT, Home: Key.HOME, End: Key.END, PageUp: Key.PAGE_UP, PageDown: Key.PAGE_DOWN, Space: Key.SPACE } as Record<string, string>)[parsed.key.name] ?? (Key as unknown as Record<string, string>)[parsed.key.name.toUpperCase()];
          if (!key) throw new EngineError('UNSUPPORTED_CAPABILITY', 'WebDriver cannot dispatch this key', { retryable: false });
          await element.sendKeys(...modifiers, key, Key.NULL); return;
        }
        case 'selectOption': {
          if ((await element.getTagName()).toLowerCase() !== 'select') throw new EngineError('UNSUPPORTED_CAPABILITY', 'selectOption requires a native select element', { retryable: false });
          const options = await element.findElements(By.css('option'));
          const requested = action.value;
          const matches: WebElement[] = [];
          for (const [index, option] of options.entries()) {
            const match = typeof requested === 'string' ? (await option.getText()) === requested :
              'label' in requested ? (await option.getText()) === requested.label :
              'value' in requested ? (await option.getAttribute('value')) === requested.value : index === requested.index;
            if (match) matches.push(option);
          }
          if (matches.length !== 1) throw new ConfigurationError('INVALID_ARGUMENT', 'selectOption requires exactly one matching option');
          if (!(await matches[0]!.isSelected())) await matches[0]!.click();
          return;
        }
        case 'check': case 'uncheck': if ((await element.isSelected()) !== (action.kind === 'check')) await element.click(); return;
        case 'focus': await element.sendKeys(Key.NULL); return;
        case 'hover': await driver.actions({ async: true }).move({ origin: element }).perform(); return;
        case 'scrollIntoView': await driver.executeScript('arguments[0].scrollIntoView({block:"nearest"})', element); return;
        default: throw new EngineError('UNSUPPORTED_CAPABILITY', `WebDriver does not support ${action.kind}`, { retryable: false });
      }
    }, true);
  }

  /** Writes source-masked screenshot bytes under the attempt's artifact directory. */
  async screenshot(_label: string | undefined, context: OperationContext): Promise<string> {
    if (!this.options.screenshot || !this.session || !this.attempt) throw new EngineError('UNSUPPORTED_CAPABILITY', 'No screenshot provider configured', { retryable: false });
    const attempt = this.attempt;
    const file = `screenshots/${++this.artifactIndex}.png`;
    const bytes = await this.command(context, () => this.options.screenshot!(this.session!, context));
    if (bytes.length < 8 || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new EngineError('ENGINE_FAILURE', 'Screenshot provider returned no PNG', { retryable: false });
    await mkdir(path.join(attempt.artifactsDir, 'screenshots'), { recursive: true });
    await writeFile(path.join(attempt.artifactsDir, file), bytes);
    return file;
  }
}
