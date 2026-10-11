import { test, expect } from '@e2e-dev/webdriver';

test('agent records locally annotated screenshot evidence', async ({ app, agent, screen }) => {
  await app.open('/');
  await agent.act('Take and record an annotated screenshot using annotate_screenshot. Mark the Apply button with the exact Chinese caption 点击这里应用 and the Display name textbox with 输入名称. Do not click or edit any controls.');
  await expect(screen.getByLabel('Display name')).toHaveValue('');
  await expect(screen.getByRole('status', 'Result')).toHaveText('Nothing applied');
});
