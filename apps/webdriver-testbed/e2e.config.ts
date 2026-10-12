import { webdriver } from '@e2e-dev/webdriver';
import { edgeSession } from '@e2e-dev/webdriver/edge';
import type { E2EConfig } from 'e2e';
import { testbedScreenshot } from './evidence.ts';

export default {
  workers: 1, retries: 0, cache: 'off', trace: 'on', timeout: 90_000,
  targets: [{
    name: 'edge',
    app: { url: 'http://127.0.0.1:4387', command: { executable: 'node', args: ['server.mjs'], env: { PORT: '4387', CHANGED_CONTROL: process.env.CHANGED_CONTROL ?? '0' } } },
    engine: webdriver({
      navigation: true,
      metrics: true,
      createSession: edgeSession(),
      screenshot: testbedScreenshot,
      video: { fps: 2, ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg' },
    }),
  }],
} satisfies E2EConfig;
