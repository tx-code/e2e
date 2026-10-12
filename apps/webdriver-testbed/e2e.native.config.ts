import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { webdriver, type WebDriverSession } from '@e2e-dev/webdriver';
import { edgeSession } from '@e2e-dev/webdriver/edge';
import { screenshotAnnotationTools } from '@e2e-dev/webdriver/annotations';
import { captureWindowsProcess, windowsDialogTools, type WindowsProcess } from '@e2e-dev/webdriver/windows';
import { chatgpt } from 'e2e/oauth/chatgpt';
import type { E2EConfig } from 'e2e';
import { testbedScreenshot } from './evidence.ts';

let owner: WindowsProcess | undefined;
let session: WebDriverSession | undefined;
let saveDestination = '';
const directory = path.resolve('.e2e/native-fixture');
const sample = path.join(directory, 'sample.txt');
export default {
  workers: 1, retries: 0, cache: 'off', trace: 'on', timeout: 120000,
  targets: [{ name: 'native-edge', app: { url: 'http://127.0.0.1:4387', command: { executable: 'node', args: ['server.mjs'] } },
    engine: webdriver({ navigation: true,
      screenshot: testbedScreenshot,
      video: { fps: 2, ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg' },
      async createSession(info, attempt) {
        await mkdir(directory, { recursive: true });
        await writeFile(sample, 'Neutral test data.');
        await writeFile(path.join(directory, 'latest-selection.json'), JSON.stringify({ result: 'pending' }));
        saveDestination = path.join(directory, `${attempt.attemptId}-saved.txt`);
        await writeFile(path.join(directory, 'expected.json'), JSON.stringify({ input: sample, output: saveDestination }));
        const browser = await edgeSession()(info, attempt);
        const driver = browser.driver;
        const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-File', 'native-dialog.ps1', '-ResultPath', path.join(directory, 'latest-selection.json'), '-InitialDirectory', directory, '-SaveAfterOpen'], { windowsHide: true, stdio: 'ignore' });
        try { owner = await captureWindowsProcess(child.pid!, attempt.signal); }
        catch (error) { child.kill(); await browser.close(); throw error; }
        session = { driver, close: async () => { session = undefined; owner = undefined; if (child.exitCode === null) child.kill(); await browser.close(); } };
        return session;
      },
    }),
  }],
  agents: { default: { model: chatgpt('gpt-6-astra'), maxModelCalls: 12,
    tools: {
      ...windowsDialogTools({ owner: () => owner, files: { sample }, saveFiles: { copy: () => saveDestination } }),
      ...screenshotAnnotationTools({ session: () => session, screenshot: testbedScreenshot }),
    },
  } },
} satisfies E2EConfig;
