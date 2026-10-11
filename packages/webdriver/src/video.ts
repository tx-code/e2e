import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { EngineError, raceAbort, type VideoSegment } from 'e2e/engine';

interface Frame { file: string; at: number }

/** Keeps elapsed capture time, rather than playing delayed samples at a false fixed speed. */
export function frameManifest(frames: readonly Frame[], endedAt: number): string {
  return 'ffconcat version 1.0\n' + frames.map((frame, index) =>
    `file ${frame.file}\nduration ${Math.max(0.04, ((frames[index + 1]?.at ?? endedAt) - frame.at) / 1000).toFixed(3)}\n`).join('')
    + (frames.length ? `file ${frames.at(-1)!.file}\n` : '');
}

/** Runs only the configured executable with fixed arguments, never a shell command. */
async function ffmpeg(executable: string, args: string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal });
    let failure: EngineError | undefined;
    child.stderr.resume();
    child.once('error', (cause) => { failure = new EngineError('ENGINE_FAILURE', 'Video encoder could not run; check the configured FFmpeg executable', { retryable: false, cause }); });
    child.once('close', (code) => {
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new EngineError('ENGINE_FAILURE', 'Video encoder failed; no video is attached', { retryable: false }));
    });
  });
}

/** Owns one bounded, page-only frame sequence and its local encoder process. */
export class PageVideoRecorder {
  private readonly id = randomUUID();
  private readonly frames: Frame[] = [];
  private readonly controller = new AbortController();
  private readonly directory: string;
  private readonly output: string;
  private readonly files: string[] = [];
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private active = false;
  private error: unknown;
  private bytes = 0;
  private dimensions: string | undefined;
  private stopping: Promise<readonly VideoSegment[]> | undefined;

  constructor(private readonly options: {
    artifactsDir: string;
    executable: string;
    fps: number;
    capture: (signal: AbortSignal) => Promise<Uint8Array | undefined>;
  }) {
    this.directory = path.join(options.artifactsDir, 'video', `frames-${this.id}`);
    this.output = `video/page-${this.id}.mp4`;
  }

  /** Fails early for a missing encoder; no encoder or frame loop runs unless video was requested. */
  async start(signal: AbortSignal): Promise<void> {
    await ffmpeg(this.options.executable, ['-hide_banner', '-version'], AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    await mkdir(this.directory, { recursive: true });
    this.active = true;
    this.loop = this.record();
  }

  private async capture(): Promise<void> {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(3000)]);
    const at = Date.now();
    const data = await raceAbort(this.options.capture(signal), signal, 'Video frame');
    if (!data) return;
    signal.throwIfAborted();
    const png = Buffer.from(data);
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new EngineError('ENGINE_FAILURE', 'Video capture must return a masked PNG', { retryable: false });
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height || width * height > 25_000_000) throw new EngineError('ENGINE_FAILURE', 'Video frame exceeds the pixel budget', { retryable: false });
    const dimensions = `${width}x${height}`;
    if (this.dimensions !== undefined && this.dimensions !== dimensions) throw new EngineError('ENGINE_FAILURE', 'Viewport size changed during video recording', { retryable: false });
    this.dimensions = dimensions;
    if (this.frames.length >= 3000 || this.bytes + png.length > 128_000_000 || (this.frames[0] && at - this.frames[0].at > 600_000)) throw new EngineError('ENGINE_FAILURE', 'Video recording exceeded its 10-minute, 3000-frame or 128 MB budget', { retryable: false });
    const file = `frame-${String(this.frames.length).padStart(6, '0')}.png`;
    this.files.push(file);
    await writeFile(path.join(this.directory, file), png, { flag: 'wx' });
    this.frames.push({ file, at });
    this.bytes += png.length;
  }

  private async record(): Promise<void> {
    while (this.active) {
      const started = performance.now();
      try { await this.capture(); }
      catch (error) { this.error = error; this.active = false; break; }
      if (!this.active) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { this.wake = undefined; resolve(); }, Math.max(1, 1000 / this.options.fps - (performance.now() - started)));
        this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      });
    }
  }

  /** Flushes a final sample, encodes with elapsed-time durations, and removes only owned temporary files. */
  stop(signal: AbortSignal): Promise<readonly VideoSegment[]> {
    return this.stopping ??= this.finish(signal);
  }

  private async finish(signal: AbortSignal): Promise<readonly VideoSegment[]> {
    this.active = false;
    this.wake?.();
    try {
      await this.loop;
      signal.throwIfAborted();
      if (this.error) throw this.error;
      await this.capture();
      if (this.frames.length === 0) return [];
      const manifest = 'frames.ffconcat';
      this.files.push(manifest);
      await writeFile(path.join(this.directory, manifest), frameManifest(this.frames, Date.now()), { flag: 'wx' });
      await ffmpeg(this.options.executable, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'concat', '-safe', '1',
        '-i', path.join(this.directory, manifest), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        path.join(this.options.artifactsDir, this.output),
      ], AbortSignal.any([signal, this.controller.signal, AbortSignal.timeout(15000)]));
      return [{ path: this.output, startedAt: new Date(this.frames[0]!.at).toISOString() }];
    } catch (cause) {
      await unlink(path.join(this.options.artifactsDir, this.output)).catch(() => {});
      throw new EngineError('ENGINE_FAILURE', 'Page video unavailable: capture was refused, interrupted, exceeded its budget, or encoding failed', { retryable: false, cause });
    } finally {
      await this.cleanup();
    }
  }

  /** Stops background work when attempt teardown runs without a normal video stop. */
  async dispose(): Promise<void> {
    this.active = false;
    this.wake?.();
    this.controller.abort();
    if (this.stopping) await this.stopping.catch(() => {});
    else { await this.loop; await this.cleanup(); }
  }

  private async cleanup(): Promise<void> {
    for (const file of this.files) await unlink(path.join(this.directory, file)).catch(() => {});
    await rmdir(this.directory).catch(() => {});
  }
}
