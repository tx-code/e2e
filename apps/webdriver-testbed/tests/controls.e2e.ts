import { test } from '@e2e-dev/webdriver';
import { expect } from 'e2e';

test('native input and semantic locators', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', 'Form controls')).toBeVisible();
  await screen.getByLabel('Display name').fill('Sample');
  await expect(screen.getByTestId('display-name')).toHaveValue('Sample');
  await screen.getByLabel('Choice').selectOption({ value: 'blue' });
  await screen.getByRole('checkbox', 'Feature enabled').check();
  await screen.getByRole('button', 'Apply').tap();
  await expect(screen.getByRole('status', 'Result')).toHaveText('Sample|blue|true');
  await screen.getByRole('button', 'Double click').doubleTap();
  await expect(screen.getByRole('status', 'Double count')).toHaveText('1');
  await app.screenshot('controls');
});

test('locators resolve a replaced field and keyboard input', async ({ app, screen, webdriver }) => {
  await app.open('/');
  const field = screen.getByTestId('display-name');
  await field.fill('Original');
  await screen.getByRole('button', 'Replace field').tap();
  await field.fill('Replacement');
  await field.press('Control+a');
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await webdriver.locator('#display-name').fill('After replacement');
  await expect(screen.getByLabel('Display name')).toHaveValue('After replacement');
});
