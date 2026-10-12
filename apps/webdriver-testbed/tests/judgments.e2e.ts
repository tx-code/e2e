import { test, expect, beforeEach, afterEach } from '@e2e-dev/webdriver';

beforeEach(async ({ app }) => { await app.open('/judgments'); await app.screenshot('before-judgment'); });
afterEach(async ({ app }) => { await app.screenshot('after-judgment'); });

/** A negative scenario passes only for its declared error, not for any exception. */
async function refuses(action: () => Promise<unknown>, code: string) {
  let actual: unknown;
  try { await action(); } catch (error) { actual = (error as { code?: unknown }).code; }
  expect(actual).toBe(code);
}

const inventorySchema = { '~standard': { version: 1 as const, vendor: 'neutral-fixture', validate(value: unknown) {
  const data = value as { quantity?: unknown; material?: unknown } | null;
  return data && typeof data.quantity === 'number' && Number.isFinite(data.quantity) && typeof data.material === 'string'
    ? { value: { quantity: data.quantity, material: data.material } }
    : { issues: [{ message: 'Expected numeric quantity and string material' }] };
} } };
const serialSchema = { '~standard': { version: 1 as const, vendor: 'neutral-fixture', validate(value: unknown) {
  const data = value as { serial?: unknown } | null;
  return data && typeof data.serial === 'string' ? { value: { serial: data.serial } } : { issues: [{ message: 'Expected string serial' }] };
} } };

test('assert accepts visible facts', async ({ agent, screen }) => {
  await expect(screen.getByText('Quantity: 7', { exact: true })).toBeVisible();
  await agent.assert('The displayed material is Aluminium and the quantity is seven.', { timeout: 30000, vision: false });
});

test('assert rejects stale success', async ({ agent, screen }) => {
  await expect(screen.getByRole('status', 'Current operation')).toHaveText('Current operation, revision 2: Running');
  await refuses(() => agent.assert('The current operation for revision 2 has completed successfully.', { timeout: 30000, vision: false }), 'ASSERTION_FAILED');
});

test('assert refuses invisible evidence', async ({ agent }) => {
  await refuses(() => agent.assert('The current document has been durably saved to disk.', { timeout: 30000, vision: false }), 'ASSERTION_INCONCLUSIVE');
});

test('extract returns correct values', async ({ agent }) => {
  const data = await agent.extract('Extract the displayed quantity and material into fields quantity and material.', { schema: inventorySchema, timeout: 30000, vision: false });
  expect(data).toEqual({ quantity: 7, material: 'Aluminium' });
});

test('extract refuses missing data', async ({ agent }) => {
  await refuses(() => agent.extract('Extract the inventory batch serial number into the serial field.', { schema: serialSchema, timeout: 30000, vision: false }), 'ASSERTION_INCONCLUSIVE');
});

test('waitFor observes delayed readiness', async ({ app, agent, screen }) => {
  await app.open('/judgments?delayed=1');
  await expect(screen.getByRole('status', 'Readiness')).toHaveText('Pending');
  await agent.waitFor('The Readiness status says Ready.', { timeout: 30000, interval: 250, maxModelCalls: 4, vision: false });
  await expect(screen.getByRole('status', 'Readiness')).toHaveText('Ready');
});

test('waitFor times out on an unchanged page', async ({ agent }) => {
  await refuses(() => agent.waitFor('The Readiness status says Ready.', { timeout: 12000, interval: 250, maxModelCalls: 4, vision: false }), 'STEP_TIMEOUT');
});

test('waitFor obeys its call budget', async ({ agent }) => {
  await refuses(() => agent.waitFor('The Readiness status says Ready.', { timeout: 30000, interval: 250, maxModelCalls: 1, vision: false }), 'STEP_BUDGET_EXHAUSTED');
});
