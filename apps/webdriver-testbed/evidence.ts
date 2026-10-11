import type { WebDriverSession } from '@e2e-dev/webdriver';
import { EngineError } from 'e2e/engine';

/** Captures only the owned, non-sensitive testbed page as local evidence. */
export async function testbedScreenshot({ driver }: WebDriverSession): Promise<Uint8Array> {
  const allowed = await driver.executeScript<boolean>(() =>
    location.origin === 'http://127.0.0.1:4387'
    && document.title === 'WebDriver testbed'
    && document.querySelectorAll('input[type="password"], iframe').length === 0);
  if (!allowed) throw new EngineError('UNSUPPORTED_CAPABILITY', 'Screenshot refused: only the owned non-sensitive testbed page is allowed', { retryable: false });
  return Buffer.from(await driver.takeScreenshot(), 'base64');
}
