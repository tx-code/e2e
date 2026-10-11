import { test } from '@e2e-dev/webdriver';
import { expect } from 'e2e';

test('a verified agent goal can replay on a fresh session', async ({ app, screen, agent }) => {
  await app.open('/');
  await screen.getByLabel('Display name').fill('Cache benchmark');
  await agent.act('Choose Green in the Choice dropdown, enable Feature enabled, and submit the form.');
  await expect(screen.getByRole('status', 'Result')).toHaveText('Cache benchmark|green|true');
});
