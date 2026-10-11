import { test, expect } from '@e2e-dev/webdriver';

test('local screenshots document a verified state change', async ({ app, screen }) => {
  await app.open('/');
  await app.screenshot('before-edit');
  await screen.getByLabel('Display name').fill('Local screenshot evidence');
  await screen.getByRole('button', 'Apply', { exact: true }).tap();
  await expect(screen.getByRole('status', 'Result')).toHaveText('Local screenshot evidence||false');
  await app.screenshot('after-verification');
});

test('screenshot provider refuses a page containing secure input', async ({ app, webdriver }) => {
  await app.open('/');
  await webdriver.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'password';
    document.body.append(input);
  });
  let refusal = '';
  try { await app.screenshot('must-not-be-written'); }
  catch (error) { refusal = String(error); }
  expect(refusal).toContain('Screenshot refused');
});
