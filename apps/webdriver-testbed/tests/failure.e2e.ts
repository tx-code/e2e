import { test } from '@e2e-dev/webdriver';
import { expect } from 'e2e';

test('intentional failure reports an assertion and a screenshot', { tags: ['expected-failure'] }, async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('status', 'Result')).toHaveText('This value is intentionally absent', { timeout: 2000 });
});
