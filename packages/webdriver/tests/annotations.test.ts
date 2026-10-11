import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import type { WebDriver } from 'selenium-webdriver';
import { screenshotAnnotationTools } from '../src/annotations.ts';

const { attach } = vi.hoisted(() => ({ attach: vi.fn(async () => 'artifact') }));
vi.mock('e2e/agent', async (original) => ({ ...await original<object>(), getToolContext: () => ({ attachScreenshot: attach }) }));
const input = { annotations: [{ role: 'button', name: 'Apply', text: '点击这里保存 <&> "测试"' }] };
const call = { toolCallId: 'annotation', messages: [], context: {} };

/** Supplies a fixed viewport and a real PNG through the public tool factory. */
async function fixture() {
  const png = await sharp({ create: { width: 320, height: 200, channels: 4, background: 'white' } }).png().toBuffer();
  const geometry = { width: 320, height: 200, url: 'http://fixture/', rects: [{ x: 40, y: 40, width: 100, height: 30 }] };
  const executeScript = vi.fn().mockResolvedValueOnce({ root: { ref: { id: 'root' }, children: [{ ref: { id: 'button' }, role: 'button', name: 'Apply' }] }, truncated: false }).mockResolvedValue(geometry);
  const session = { driver: { executeScript } as unknown as WebDriver, close: async () => {} };
  const screenshot = vi.fn(async () => png);
  const tools = screenshotAnnotationTools({ session: () => session, screenshot });
  return { png, geometry, executeScript, screenshot, tool: tools.annotate_screenshot!, session };
}

beforeEach(() => attach.mockClear());
describe('annotated local evidence', () => {
  it('preserves the original, renders escaped Chinese captions and attaches both images without returning pixels', async () => {
    const { tool, png } = await fixture();
    const result = await tool.tool.execute!(input, call);
    expect(tool.annotations.mutates).toBe(false);
    expect(attach).toHaveBeenCalledTimes(2);
    const calls = attach.mock.calls as unknown as [{ data: Uint8Array }, string][];
    expect(Buffer.from(calls[0]![0].data)).toEqual(png);
    const output = await sharp(calls[1]![0].data).metadata();
    expect(output.width).toBe(320);
    expect(output.height).toBeGreaterThan(200);
    expect(calls[0]![1]).not.toBe(calls[1]![1]);
    expect(String(result)).not.toContain('base64');
  });

  it('refuses missing targets before capturing pixels', async () => {
    const { tool, screenshot } = await fixture();
    await expect(tool.tool.execute!({ annotations: [{ ...input.annotations[0], name: 'Missing' }] }, call)).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
    expect(screenshot).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it('scales CSS bounds to high-DPI image pixels', async () => {
    const { tool, screenshot } = await fixture();
    screenshot.mockResolvedValueOnce(await sharp({ create: { width: 640, height: 400, channels: 4, background: 'white' } }).png().toBuffer());
    await tool.tool.execute!(input, call);
    const calls = attach.mock.calls as unknown as [{ data: Uint8Array; scale: number }, string][];
    expect(calls[1]![0].scale).toBe(2);
    const pixel = await sharp(calls[1]![0].data).extract({ left: 80, top: 100, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...pixel]).toEqual([215, 25, 32]);
  });

  it('refuses ambiguous targets', async () => {
    const { tool, executeScript } = await fixture();
    executeScript.mockReset().mockResolvedValue({ root: { role: 'button', name: 'Apply', children: [{ role: 'button', name: 'Apply' }] } });
    await expect(tool.tool.execute!(input, call)).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
    expect(attach).not.toHaveBeenCalled();
  });

  it('refuses moving targets rather than publishing misplaced annotations', async () => {
    const { tool, screenshot, executeScript, geometry, png } = await fixture();
    screenshot.mockImplementationOnce(async () => { executeScript.mockResolvedValue({ ...geometry, width: 321 }); return png; });
    await expect(tool.tool.execute!(input, call)).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
    expect(attach).not.toHaveBeenCalled();
  });

  it('rejects non-viewport images without attachments', async () => {
    const { tool, screenshot } = await fixture();
    screenshot.mockResolvedValueOnce(await sharp({ create: { width: 320, height: 400, channels: 4, background: 'white' } }).png().toBuffer());
    await expect(tool.tool.execute!(input, call)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    expect(attach).not.toHaveBeenCalled();
  });

  it('propagates provider masking refusal without attachments', async () => {
    const { tool, screenshot } = await fixture();
    screenshot.mockRejectedValueOnce(new Error('masking unavailable'));
    await expect(tool.tool.execute!(input, call)).rejects.toThrow('masking unavailable');
    expect(attach).not.toHaveBeenCalled();
  });

  it('rejects oversized input and session replacement', async () => {
    const { session, screenshot, png } = await fixture();
    let active: typeof session | undefined = session;
    const tool = screenshotAnnotationTools({ session: () => active, screenshot }).annotate_screenshot!;
    await expect(tool.tool.execute!({ annotations: Array(9).fill(input.annotations[0]) }, call)).rejects.toThrow();
    screenshot.mockImplementationOnce(async () => { active = undefined; return png; });
    await expect(tool.tool.execute!(input, call)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(attach).not.toHaveBeenCalled();
  });

  it('does not take screenshots after cancellation or without an active session', async () => {
    const { tool, screenshot } = await fixture();
    await expect(tool.tool.execute!(input, { ...call, abortSignal: AbortSignal.abort() })).rejects.toThrow();
    expect(screenshot).not.toHaveBeenCalled();
    const inactive = screenshotAnnotationTools({ session: () => undefined, screenshot });
    await expect(inactive.annotate_screenshot!.tool.execute!(input, call)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
