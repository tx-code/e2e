import { test, expect } from '@e2e-dev/webdriver';

test('plain-value assertion leaves the recording unconfirmed', async ({ app, agent, webdriver }) => {
  await app.open('/');
  await agent.act('Apply the form');
  const text = await webdriver.evaluate(() => document.getElementById('result')?.textContent);
  expect(text).toBe('||false');
});

test('locator assertion confirms the recording', async ({ app, agent, screen }) => {
  await app.open('/');
  await agent.act('Apply the form');
  await expect(screen.getByRole('status', 'Result')).toHaveText('||false');
});
