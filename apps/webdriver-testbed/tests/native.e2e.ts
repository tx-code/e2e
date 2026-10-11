import { test, expect } from '@e2e-dev/webdriver';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('agent opens and saves registered files through native dialogs', async ({ app, screen, agent }) => {
  await app.open('/');
  await agent.act('Open the registered sample file in the native file dialog. The application will then show Save As: save to the registered copy destination. After saving, fill Display name on the web page with Native selection complete.');
  const selection = JSON.parse((await readFile('.e2e/native-fixture/latest-selection.json', 'utf8')).replace(/^\uFEFF/, ''));
  const expected = JSON.parse(await readFile('.e2e/native-fixture/expected.json', 'utf8'));
  expect(selection.result).toBe('OK');
  expect(selection.file.toLowerCase()).toBe(path.resolve('.e2e/native-fixture/sample.txt').toLowerCase());
  expect(selection.savedFile.toLowerCase()).toBe(expected.output.toLowerCase());
  expect(await readFile(expected.output, 'utf8')).toBe('Neutral test data.');
  expect(await readFile(selection.file, 'utf8')).toBe('Neutral test data.');
  await expect(screen.getByLabel('Display name')).toHaveValue('Native selection complete');
});
