import { spawn } from 'node:child_process';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, type DefinedTool } from 'e2e/agent';
import { ConfigurationError, EngineError } from 'e2e/engine';

export interface WindowsProcess {
  readonly processId: number;
  /** Exact Windows process creation time, encoded as decimal ticks. */
  readonly startedAtTicks: string;
}

interface NativeResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  dispatched?: boolean;
}

/** Sends data over stdin to a fixed helper, never through generated shell commands. */
async function native(request: { action: string; [key: string]: unknown }, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32') throw new EngineError('UNSUPPORTED_CAPABILITY', 'Windows dialog tools require Windows', { retryable: false });
  signal?.throwIfAborted();
  const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
  const mutation = ['choose', 'save', 'cancel'].includes(request.action);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-File', fileURLToPath(new URL('../native/windows-dialogs.ps1', import.meta.url))], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal: combined,
    });
    let output = '';
    let failed = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 256000) { failed = true; child.kill(); }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', (cause) => reject(new EngineError(mutation ? 'ACTION_MAY_HAVE_COMMITTED' : combined.aborted ? signal?.aborted ? 'CANCELLED' : 'OPERATION_TIMEOUT' : 'ENGINE_FAILURE', 'Windows helper failed or was interrupted; check the current dialog before retrying', { retryable: false, cause })));
    child.on('close', (code) => {
      if (failed || code !== 0) { reject(new EngineError(mutation ? 'ACTION_MAY_HAVE_COMMITTED' : 'ENGINE_FAILURE', 'Windows helper did not return a bounded result', { retryable: false })); return; }
      try {
        const result = JSON.parse(output.replace(/^\uFEFF/, '')) as NativeResult;
        if (!result.ok) throw new EngineError(result.dispatched ? 'ACTION_MAY_HAVE_COMMITTED' : 'NOT_ACTIONABLE', result.error ?? 'Native dialog operation refused', { retryable: false });
        resolve(result.value);
      } catch (cause) { reject(cause instanceof EngineError ? cause : new EngineError(mutation ? 'ACTION_MAY_HAVE_COMMITTED' : 'ENGINE_FAILURE', 'Invalid native helper response', { retryable: false, cause })); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** Captures identity immediately after the host starts a process it owns. */
export async function captureWindowsProcess(processId: number, signal?: AbortSignal): Promise<WindowsProcess> {
  if (!Number.isSafeInteger(processId) || processId <= 0) throw new ConfigurationError('INVALID_ARGUMENT', 'Expected a positive process id');
  return await native({ action: 'identity', processId }, signal) as WindowsProcess;
}

/** Keeps schemas concrete without importing a second AI SDK type hierarchy. */
function nativeTool<I>(definition: {
  description: string;
  inputSchema: z.ZodType<I>;
  execute: (input: I, execution: { abortSignal?: AbortSignal }) => Promise<string>;
}) { return definition; }

/** Provides process-scoped native window inspection and allowlisted file selection. */
export function windowsDialogTools(options: {
  readonly owner: () => WindowsProcess | undefined;
  readonly files: Readonly<Record<string, string>>;
  readonly saveFiles?: Readonly<Record<string, string | (() => string)>>;
}): Readonly<Record<string, DefinedTool>> {
  const files = { ...options.files };
  const names = Object.keys(files);
  const saveFiles = { ...options.saveFiles };
  const saveNames = Object.keys(saveFiles);
  if (!names.length || names.some((name) => !name.trim())) throw new ConfigurationError('INVALID_CONFIG', 'Windows dialog tools need named files');
  const owner = (): WindowsProcess => {
    const current = options.owner();
    if (!current) throw new EngineError('INVALID_STATE', 'No owned native process is active', { retryable: false });
    return current;
  };
  return {
    registered_files: defineTool(nativeTool({
      description: 'Read existence and byte sizes of registered input files and save destinations. Use after Save As to check that a file was created, including when the dialog process has exited. Reads metadata only, not file contents. Does not prove application-specific data correctness.',
      inputSchema: z.object({}),
      execute: async () => {
        owner();
        const inspect = async (registered: string | (() => string)) => {
          const target = typeof registered === 'function' ? registered() : registered;
          if (!target) return { exists: false };
          try { const entry = await stat(target); return { exists: true, file: entry.isFile(), bytes: entry.size }; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }; throw error; }
        };
        const inputs = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await inspect(file)])));
        const outputs = Object.fromEntries(await Promise.all(Object.entries(saveFiles).map(async ([name, file]) => [name, await inspect(file)])));
        return JSON.stringify({ inputs, outputs });
      },
    }), { mutates: false }),
    native_windows: defineTool(nativeTool({
      description: 'Inspect owned native windows when diagnosing an unknown modal or resolving a refused file operation. Open and Save As tools locate a unique dialog themselves; calling this tool first is unnecessary for those operations. Returns window ids, filePicker for Open dialogs and savePicker for Save As dialogs. Does not read file contents or password values.',
      inputSchema: z.object({}),
      execute: async (_input, execution) => JSON.stringify(await native({ action: 'observe', owner: owner() }, execution.abortSignal)),
    }), { mutates: false }),
    choose_native_file: defineTool(nativeTool({
      description: `Choose a registered file in an already-open native Open dialog. Omit windowId to select the sole enabled Open dialog owned by this test process. If none or several match, no action is taken; inspect native_windows to resolve the issue. Available file aliases: ${names.join(', ')}. This only selects the file; verify import completion in the application afterward.`,
      inputSchema: z.object({ windowId: z.string().regex(/^\d+$/).optional(), file: z.enum(names as [string, ...string[]]) }),
      execute: async ({ windowId, file }, execution) => {
        if (!Object.hasOwn(files, file)) throw new ConfigurationError('INVALID_ARGUMENT', 'Unknown file alias');
        const selected = await realpath(files[file]!);
        if (!(await stat(selected)).isFile()) throw new ConfigurationError('INVALID_ARGUMENT', 'The configured path is not a file');
        await access(selected, constants.R_OK);
        await native({ action: 'choose', owner: owner(), windowId, filePath: selected }, execution.abortSignal);
        return `Selected registered file ${file}. Check the application for import completion.`;
      },
    }), { mutates: true }),
    ...(saveNames.length ? { save_native_file: defineTool(nativeTool({
      description: `Choose a registered destination in an already-open native Save As dialog. Omit windowId to select the sole enabled Save As dialog owned by this test process. If none or several match, no action is taken; inspect native_windows to resolve the issue. Destinations: ${saveNames.join(', ')}. Refuses existing files. Verify the application's saved file afterward.`,
      inputSchema: z.object({ windowId: z.string().regex(/^\d+$/).optional(), destination: z.enum(saveNames as [string, ...string[]]) }),
      execute: async ({ windowId, destination }, execution) => {
        if (!Object.hasOwn(saveFiles, destination)) throw new ConfigurationError('INVALID_ARGUMENT', 'Unknown save destination');
        const registered = saveFiles[destination]!;
        const resolved = typeof registered === 'function' ? registered() : registered;
        if (typeof resolved !== 'string' || !resolved.trim()) throw new ConfigurationError('INVALID_ARGUMENT', 'No destination is available for this attempt');
        const configured = path.resolve(resolved);
        const parent = await realpath(path.dirname(configured));
        const selected = path.join(parent, path.basename(configured));
        try {
          await lstat(selected);
          throw new ConfigurationError('INVALID_ARGUMENT', 'Refusing to overwrite an existing save destination');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await native({ action: 'save', owner: owner(), windowId, filePath: selected }, execution.abortSignal);
        return `Submitted registered save destination ${destination}. Verify the saved file in the application.`;
      },
    }), { mutates: true }) } : {}),
    cancel_native_dialog: defineTool(nativeTool({
      description: 'Close a standard native dialog owned by this test process. Use to cancel a file picker or dismiss an error. Read native_windows first and select a dialog. Windows without the standard dialog class are refused.',
      inputSchema: z.object({ windowId: z.string().regex(/^\d+$/) }),
      execute: async ({ windowId }, execution) => {
        await native({ action: 'cancel', owner: owner(), windowId }, execution.abortSignal);
        return 'Requested native dialog close. Observe the current state before continuing.';
      },
    }), { mutates: true }),
  };
}
