# WebDriver engine

`@e2e-dev/webdriver` connects the e2e runner to a Selenium WebDriver session.
The application and driver stay inside the session factory. The engine does
not replace an attached document, open a second browser context, or own a
desktop application by its process name.

Configure `webdriver({ createSession })`. The factory receives the target's
app declaration, environment, abort signal, and attempt identity. Return
`{ driver, close }`; `close` releases only the session and host you created.
Each attempt, including a repeat or retry, calls the factory again.

Use `test` from this package for the typed `webdriver` fixture, and `expect`
from `e2e`. `screen` provides semantic locators; `webdriver.locator` accepts
CSS or XPath for attributes that have no semantic query. Run the suite with
the built e2e CLI, including `--repeat-each` for repeatability checks.

The initial implementation reads the main document's native DOM. Frames,
shadow roots, remote Grid deployments, coordinate actions, video, and saved
sessions are not implemented. Navigation is opt-in. The initial verification
target is Edge; other browsers need their own verification.

Screenshot support is opt-in through `screenshot(session, context)`, which
must return source-masked PNG bytes. The engine supplies no unmasked model
pixels and declares no screenshot capability when the callback is absent.
An adapter that cannot prove its screenshots mask secure fields must omit
the callback. This keeps host-specific rendering and masking outside the
generic engine.

Set `metrics: true` to record operation names and milliseconds through e2e's
local app-log channel. The measurements contain no selectors, field values,
or document text. They distinguish document observation and reference
resolution from the model's time choosing an action.

## Windows file dialogs

`@e2e-dev/webdriver/windows` exports `captureWindowsProcess(pid)` and
`windowsDialogTools({ owner, files, saveFiles })`. Capture the identity of the process
your factory starts, return it from `owner`, and clear it during cleanup.
Register input files and save destinations by alias. Save destination values
can be callbacks returning a fresh path for each attempt. The agent gets:

- `native_windows` reads visible owned windows, dialog controls and text.
- `choose_native_file` selects a registered file in a supported open-file dialog.
- `save_native_file` fills a registered Save As destination, when `saveFiles` is configured.
- `registered_files` reads existence and byte sizes, without reading contents.
- `cancel_native_dialog` closes an owned native dialog.

The helper runs in Windows PowerShell with a 15-second limit. It checks
the process creation time and window owner, accepts no model-supplied
paths or shell commands, and reads no file contents. Edit values are not
included in the window inspection. The initial supported pickers are
standard Windows Open and Save As dialogs with English, Chinese, German,
French or Portuguese buttons. Other native controls need their own support.
Saving refuses an existing destination, including a symbolic link. The
parent directory must already exist. The native window reader reports
`processExited` when its owned process has ended; it does not attach to a
replacement process.

Native input uses Windows messages, outside the WebDriver DOM protocol.
These tools supplement WebDriver for the OS dialog boundary. They do not
implement application workflows. File selection does not prove an import
succeeded; follow it with an application assertion. Likewise, verify the
saved path and content after saving. See the working configuration in
[`apps/webdriver-testbed`](../../apps/webdriver-testbed/e2e.native.config.ts).

Selection, saving and cancellation are mutating project tools. The e2e replay
cache hands these actions to the model, so a step containing them cannot
promise zero model calls. Keep preparation separate from DOM-only goals
when those goals need zero-call replay, and verify each goal with a locator
assertion. Plain-value assertions do not confirm a recording.
