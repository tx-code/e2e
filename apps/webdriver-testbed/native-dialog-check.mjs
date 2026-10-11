import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { captureWindowsProcess, windowsDialogTools } from '@e2e-dev/webdriver/windows';

const directory = path.resolve('.e2e-native', `${Date.now()}`);
await mkdir(directory, { recursive: true });
const file = path.join(directory, 'sample with spaces 测试.txt');
const resultFile = path.join(directory, 'selection.json');
const savedFile = path.join(directory, 'saved with spaces 测试.txt');
await writeFile(file, 'Neutral native-dialog fixture.');
const errorDialog = process.argv.includes('--error');
const saveDialog = process.argv.includes('--save');
const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-File', 'native-dialog.ps1', '-ResultPath', resultFile, '-InitialDirectory', directory, ...(process.argv.includes('--classic') ? ['-Classic'] : []), ...(errorDialog ? ['-ErrorDialog'] : []), ...(saveDialog ? ['-SaveDialog'] : [])], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let hostError = '';
child.stderr.on('data', (chunk) => { hostError += chunk.toString(); });
let owner;
let other;
try {
  owner = await captureWindowsProcess(child.pid);
  const tools = windowsDialogTools({ owner: () => owner, files: { sample: file }, saveFiles: { output: savedFile, existing: file } });
  const invoke = async (name, args) => {
    const definition = tools[name];
    const actual = definition.tool ?? definition;
    return actual.execute(args, { toolCallId: name, messages: [] });
  };
  let observed;
  for (let index = 0; index < 8; index++) {
    observed = JSON.parse(await invoke('native_windows', {}));
    if (observed.windows.some((window) => errorDialog ? window.title === 'Fixture error' : saveDialog ? window.savePicker : window.filePicker)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await writeFile(path.join(directory, 'windows.json'), JSON.stringify(observed, null, 2));
  const picker = observed.windows.find((window) => errorDialog ? window.title === 'Fixture error' : saveDialog ? window.savePicker : window.filePicker);
  assert.ok(picker, `No supported file picker. Evidence: ${directory}`);
  if (errorDialog) {
    assert.equal(picker.filePicker, false);
    assert.ok(JSON.stringify(picker).includes('Neutral native failure marker'));
    await assert.rejects(() => invoke('choose_native_file', { windowId: picker.id, file: 'sample' }));
  }
  const originalOwner = owner;
  owner = { ...owner, startedAtTicks: '0' };
  await assert.rejects(() => invoke('native_windows', {}));
  owner = originalOwner;
  if (process.argv.includes('--foreign')) {
    other = spawn('powershell.exe', ['-NoProfile', '-STA', '-File', 'native-dialog.ps1', '-ResultPath', path.join(directory, 'other-selection.json'), '-InitialDirectory', directory], { windowsHide: true, stdio: 'ignore' });
    const otherOwner = await captureWindowsProcess(other.pid);
    const otherTools = windowsDialogTools({ owner: () => otherOwner, files: { sample: file } });
    let otherPicker;
    for (let index = 0; index < 8; index++) {
      const response = JSON.parse(await otherTools.native_windows.tool.execute({}, { toolCallId: 'observe-other', messages: [] }));
      otherPicker = response.windows.find((window) => window.filePicker);
      if (otherPicker) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(otherPicker, 'Second owned fixture must expose a real picker');
    await assert.rejects(() => invoke('choose_native_file', { windowId: otherPicker.id, file: 'sample' }));
    await otherTools.cancel_native_dialog.tool.execute({ windowId: otherPicker.id }, { toolCallId: 'cancel-other', messages: [] });
  }
  await assert.rejects(() => invoke('choose_native_file', { windowId: picker.id, file: 'unregistered' }));
  await assert.rejects(() => invoke('choose_native_file', { windowId: '0', file: 'sample' }));
  const cancel = process.argv.includes('--cancel') || errorDialog;
  if (cancel) await invoke('cancel_native_dialog', { windowId: picker.id });
  else if (saveDialog) {
    await assert.rejects(() => invoke('save_native_file', { windowId: picker.id, destination: 'existing' }));
    await assert.rejects(() => invoke('save_native_file', { windowId: picker.id, destination: 'unknown' }));
    await invoke('save_native_file', { windowId: picker.id, destination: 'output' });
  }
  else await invoke('choose_native_file', { windowId: picker.id, file: 'sample' });
  let selected;
  for (let index = 0; index < 40; index++) {
    try { selected = JSON.parse((await readFile(resultFile, 'utf8')).replace(/^\uFEFF/, '')); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(selected?.result, cancel && !errorDialog ? 'Cancel' : 'OK');
  if (!cancel) assert.equal(selected?.file.toLowerCase(), (saveDialog ? savedFile : file).toLowerCase());
  if (saveDialog && !cancel) {
    assert.equal(await readFile(savedFile, 'utf8'), 'Saved neutral fixture content.');
    assert.equal(await readFile(file, 'utf8'), 'Neutral native-dialog fixture.');
  }
  owner = undefined;
  await assert.rejects(() => invoke('native_windows', {}));
  console.log(JSON.stringify({ status: 'passed', directory, classic: process.argv.includes('--classic'), foreignWindowRefused: process.argv.includes('--foreign'), errorDialog, savedFileVerified: saveDialog && !cancel, cancelled: cancel, selectedRegisteredFile: !cancel && !saveDialog }));
} finally {
  if (child.exitCode === null && !child.killed) child.kill();
  if (other && other.exitCode === null && !other.killed) other.kill();
  await writeFile(path.join(directory, 'host.log'), hostError);
}
