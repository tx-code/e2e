import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { frameManifest, PageVideoRecorder } from '../src/video.ts';

describe('page video evidence', () => {
  it('keeps wall-clock gaps between samples and repeats the last frame for its duration', () => {
    expect(frameManifest([{ file: 'frame-000000.png', at: 1000 }, { file: 'frame-000001.png', at: 2250 }], 3000)).toBe(
      'ffconcat version 1.0\nfile frame-000000.png\nduration 1.250\nfile frame-000001.png\nduration 0.750\nfile frame-000001.png\n');
  });
  it('represents short and empty recordings without negative durations', () => {
    expect(frameManifest([{ file: 'frame-000000.png', at: 1000 }], 1000)).toContain('duration 0.040');
    expect(frameManifest([], 1000)).toBe('ffconcat version 1.0\n');
  });
  it('fails before capturing if the configured encoder cannot start', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'e2e-video-'));
    const capture = vi.fn(async () => undefined);
    const recorder = new PageVideoRecorder({ artifactsDir: directory, executable: path.join(directory, 'missing-encoder'), fps: 2, capture });
    try {
      await expect(recorder.start(new AbortController().signal)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
      expect(capture).not.toHaveBeenCalled();
      await recorder.dispose();
      expect(await readdir(directory)).toEqual([]);
    } finally { await rmdir(directory); }
  });
});
