import { Builder } from 'selenium-webdriver';
import edge from 'selenium-webdriver/edge.js';
import { webdriver } from '@e2e-dev/webdriver';
import type { E2EConfig } from 'e2e';

export default {
  workers: 1, retries: 0, cache: 'off', trace: 'on', timeout: 90_000,
  targets: [{
    name: 'edge',
    app: { url: 'http://127.0.0.1:4387', command: { executable: 'node', args: ['server.mjs'], env: { PORT: '4387', CHANGED_CONTROL: process.env.CHANGED_CONTROL ?? '0' } } },
    engine: webdriver({
      navigation: true,
      metrics: true,
      async createSession(info) {
        const options = new edge.Options();
        options.addArguments('--headless=new', '--no-first-run');
        const builder = new Builder().forBrowser('MicrosoftEdge').setEdgeOptions(options);
        const executable = info.env['WEBDRIVER_EDGE_DRIVER'];
        if (executable) builder.setEdgeService(new edge.ServiceBuilder(executable));
        const driver = await builder.build();
        return { driver, close: () => driver.quit() };
      },
      async screenshot({ driver }) {
        // The owned testbed has no secure fields; refuse if that premise changes.
        const secure = await driver.executeScript<number>(() => document.querySelectorAll('input[type="password"], iframe').length);
        if (secure !== 0) throw new Error('Screenshot masking is not available for this page');
        return Buffer.from(await driver.takeScreenshot(), 'base64');
      },
    }),
  }],
} satisfies E2EConfig;
