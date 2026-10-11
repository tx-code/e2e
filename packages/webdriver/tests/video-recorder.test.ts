import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { PageVideoRecorder } from '../src/video.ts';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=', 'base64');

beforeEach(() => {
  spawn.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stderr: { resume() {} } });
    queueMicrotask(() => child.emit('close', 0));
    return child;
  });
});

/** Cleans only the recorder's own empty test directories after each lifecycle exercise. */
async function recording(capture: (signal: AbortSignal) => Promise<Uint8Array | undefined>, run: (recorder: PageVideoRecorder, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'e2e-video-lifecycle-'));
  const recorder = new PageVideoRecorder({ artifactsDir: directory, executable: 'fixture-encoder', fps: 2, capture });
  try { await run(recorder, directory); }
  finally {
    await recorder.dispose();
    await rmdir(path.join(directory, 'video')).catch(() => {});
    await rmdir(directory);
  }
}

describe('sampled recording lifecycle', () => {
  it('flushes the final frame and encodes only once on repeated stop', async () => {
    await recording(async () => png, async (recorder, directory) => {
      const signal = new AbortController().signal;
      await recorder.start(signal);
      const first = recorder.stop(signal);
      expect(recorder.stop(signal)).toBe(first);
      const result = await first;
      expect(result).toHaveLength(1);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(spawn.mock.calls[1]![1]).toContain('libx264');
      expect(await readdir(path.join(directory, 'video'))).toEqual([]);
    });
  });
  it('never encodes blank startup pages', async () => {
    await recording(async () => undefined, async (recorder) => {
      const signal = new AbortController().signal;
      await recorder.start(signal);
      expect(await recorder.stop(signal)).toEqual([]);
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });
  it('removes temporary frames and refuses evidence after a masking failure', async () => {
    await recording(async () => { throw new Error('masking refused'); }, async (recorder, directory) => {
      const signal = new AbortController().signal;
      await recorder.start(signal);
      await expect(recorder.stop(signal)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(await readdir(path.join(directory, 'video'))).toEqual([]);
    });
  });
  it('cancels a pending capture during teardown without starting an encoder', async () => {
    await recording(async () => new Promise(() => {}), async (recorder) => {
      await recorder.start(new AbortController().signal);
      await recorder.dispose();
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects viewport changes and removes all frames instead of attaching a partial recording', async () => {
    let count = 0;
    await recording(async () => {
      const frame = Buffer.from(png);
      frame.writeUInt32BE(++count, 16);
      return frame;
    }, async (recorder, directory) => {
      const signal = new AbortController().signal;
      await recorder.start(signal);
      await expect(recorder.stop(signal)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
      expect(await readdir(path.join(directory, 'video'))).toEqual([]);
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  it('reports encoder failure after the body without retaining temporary frames', async () => {
    await recording(async () => png, async (recorder, directory) => {
      const signal = new AbortController().signal;
      await recorder.start(signal);
      spawn.mockImplementationOnce(() => {
        const child = Object.assign(new EventEmitter(), { stderr: { resume() {} } });
        queueMicrotask(() => child.emit('close', 1));
        return child;
      });
      await expect(recorder.stop(signal)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
      expect(await readdir(path.join(directory, 'video'))).toEqual([]);
    });
  });
});
