import { describe, it, expect } from 'vitest';
import { captureWindowsProcess, windowsDialogTools } from '../src/windows.ts';

const call = { toolCallId: 'test', messages: [], context: {} };

describe('native dialog tool boundaries', () => {
  it('does not act outside a host-owned attempt', async () => {
    const tools = windowsDialogTools({ owner: () => undefined, files: { sample: 'sample.txt' } });
    await expect(tools['native_windows']!.tool.execute!({}, call)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(tools['registered_files']!.tool.execute!({}, call)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(tools['cancel_native_dialog']!.tool.execute!({ windowId: '123' }, call)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects unknown file aliases before accessing the filesystem or helper', async () => {
    const tools = windowsDialogTools({ owner: () => undefined, files: { sample: 'sample.txt' } });
    await expect(tools['choose_native_file']!.tool.execute!({ windowId: '123', file: 'unknown' }, call)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('declares selection and cancellation as mutations for replay accounting', () => {
    const tools = windowsDialogTools({ owner: () => undefined, files: { sample: 'sample.txt' }, saveFiles: { output: 'output.txt' } });
    expect(tools['native_windows']!.annotations.mutates).toBe(false);
    expect(tools['registered_files']!.annotations.mutates).toBe(false);
    expect(tools['choose_native_file']!.annotations.mutates).toBe(true);
    expect(tools['cancel_native_dialog']!.annotations.mutates).toBe(true);
    expect(tools['save_native_file']!.annotations.mutates).toBe(true);
  });

  it('refuses invalid process ids and empty file registrations', async () => {
    await expect(captureWindowsProcess(-1)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(() => windowsDialogTools({ owner: () => undefined, files: {} })).toThrow();
  });
});
