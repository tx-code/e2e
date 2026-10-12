import { test, expect, beforeEach, afterEach } from '@e2e-dev/webdriver';

beforeEach(async ({ app }) => { await app.open('/judgments'); await app.screenshot('mechanism-before'); });
afterEach(async ({ app }) => { await app.screenshot('mechanism-after'); });

/** Does not treat an unrelated exception as the expected protocol outcome. */
async function refuses(action: () => Promise<unknown>, code: string) {
  let actual: unknown;
  try { await action(); } catch (error) { actual = (error as { code?: unknown }).code; }
  expect(actual).toBe(code);
}

test('judgment repairs one malformed response', async ({ agent, screen }) => {
  await agent.assert('MECHANISM_REPAIR_ONCE', { vision: false });
  await expect(screen.getByRole('status', 'Current operation')).toHaveText('Current operation, revision 2: Running');
});
test('judgment refuses a second malformed response', async ({ agent }) => {
  await refuses(() => agent.assert('MECHANISM_INVALID_ALWAYS', { vision: false }), 'MODEL_OUTPUT_INVALID');
});
test('judgment preserves provider failure', async ({ agent }) => {
  await refuses(() => agent.assert('MECHANISM_PROVIDER_ERROR', { vision: false }), 'MODEL_PROVIDER_FAILED');
});
test('judgment enforces its deadline', async ({ agent }) => {
  await refuses(() => agent.assert('MECHANISM_TIMEOUT', { timeout: 500, vision: false }), 'STEP_TIMEOUT');
});
test('extraction repairs a schema-invalid value', async ({ agent }) => {
  const schema = { '~standard': { version: 1 as const, vendor: 'mechanism-fixture', validate(value: unknown) {
    const quantity = (value as { quantity?: unknown } | null)?.quantity;
    return typeof quantity === 'number' ? { value: { quantity } } : { issues: [{ message: 'quantity must be numeric', path: ['quantity'] }] };
  } } };
  const data = await agent.extract('MECHANISM_EXTRACT_REPAIR', { schema, vision: false });
  expect(data).toEqual({ quantity: 7 });
});

test('independent checks reject schema-valid wrong data', async ({ agent, screen }) => {
  await expect(screen.getByText('Quantity: 7', { exact: true })).toBeVisible();
  const schema = { '~standard': { version: 1 as const, vendor: 'mechanism-fixture', validate(value: unknown) {
    const quantity = (value as { quantity?: unknown } | null)?.quantity;
    return typeof quantity === 'number' ? { value: { quantity } } : { issues: [{ message: 'quantity must be numeric' }] };
  } } };
  const data = await agent.extract('MECHANISM_EXTRACT_WRONG', { schema, vision: false });
  await refuses(async () => { expect(data).toEqual({ quantity: 7 }); }, 'ASSERTION_FAILED');
});
