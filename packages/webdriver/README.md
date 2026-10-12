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
shadow roots, remote Grid deployments, coordinate actions, and saved
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

## Explicit local Edge setup

`@e2e-dev/webdriver/edge` exports `edgeSession(options?)` as a
`createSession` factory. Supply `driverPath` or set `WEBDRIVER_EDGE_DRIVER`.
It does not search for another driver or invoke Selenium Manager. Relative
paths are resolved against the test project. Optional `browserPath` selects
the installed Edge executable; this is a browser factory, not a Tauri host
or an attachment to a daily browser profile.

The factory checks the executable and SHA-256, starts its own loopback
driver service, honors the runner's headed mode, and compares the actual
browser/driver three-part version prefix. `runtimeVersion` can add a known
version check before launch. Startup defaults to 30 seconds, configurable
with `startupTimeoutMs` (1–120000); driver preflight is bounded to 5 seconds.
Cleanup requests browser quit and driver shutdown with bounded waits. A
cleanup failure is reported, not silently treated as readiness.

`preflightEdgeDriver({ driverPath, runtimeVersion?, signal? })` performs
only the executable/version/hash checks. The `e2e-webdriver-doctor
[driver-executable] [runtime-version]` command wraps it (the path can also
come from the environment). Exit 0 means preflight passed, 1 means failed,
2 means incorrect invocation. It does not verify browser startup, model
login, application readiness or isolation. It installs and downloads nothing.

The engine releases a claimed session if protocol initialization fails or
is cancelled. A failed cleanup makes that engine instance unusable for
later attempts, rather than hiding a potentially live resource. A factory
that fails before returning a session must clean its own partial resources;
`edgeSession` does this for its own driver/browser resources.

## Page-only video

Configure `video: { fps: 2, ffmpegPath: 'ffmpeg' }` alongside a trusted
`screenshot` provider, then enable recording with the runner's `--video`
flag or `video: 'on'` recording mode. The engine option declares capability;
it does not start recording when the runner's mode is off. FFmpeg must be
installed separately with the `libx264` encoder. Paths are executable paths,
not shell commands. No desktop-capture input is used.

The sampler captures page-only PNGs at up to 2 fps by default (configurable
from 1 to 5), then writes a local H.264 MP4 using elapsed sample times. Slow
captures lower the actual frame rate; this is a low-frame-rate record, not
smooth screen capture. The last sample is captured at stop. The report links
the video and shows approximate step timestamps. No audio, pointer overlay,
native dialogs, other windows or annotation overlays are recorded.

Every frame uses the source-masked screenshot provider. Startup blank pages
are skipped. A masking refusal, viewport resize, capture timeout or encoder
failure rejects the video; there is no unmasked fallback. Inspect the report's
cleanup errors, not only the test verdict: e2e preserves a passing assertion
verdict when evidence cleanup fails. An empty/never-opened page returns no video.

Recording is bounded to 10 minutes of captured page time, 3000 frames and
128 MB of PNG inputs; each capture has 3 seconds and encoding has at most
15 seconds within the runner cleanup budget. Owned temporary frames are
removed on stop/dispose. MP4s remain local under the attempt's `video/`
directory unless a custom artifact store uploads them. Recording and
encoding add overhead; leave the recording mode off when not needed.

## Annotated screenshot evidence

Import `screenshotAnnotationTools` from `@e2e-dev/webdriver/annotations`.
Configure it with `session: () => activeSession` and a trusted
`screenshot: (session, signal) => Promise<Uint8Array>` provider. The provider
must return a source-masked viewport PNG without cropping, resizing its
aspect ratio, or including the desktop. It must honor the signal where
possible. Clear the active session during attempt cleanup.

Spread the returned tools into an agent's `tools`. The agent can call
`annotate_screenshot` with up to eight `{ role, name, text }` annotations.
Role and accessible name must match exactly one main-document control.
The tool draws red boxes, numbers and a caption panel below the screenshot,
without modifying the page. Chinese text requires an installed CJK font.
An obscured, stale, ambiguous, moving or offscreen target is refused rather
than guessed. No frames, canvas-internal objects or native dialogs are supported.

Original and annotated PNGs are attached to the current report step with
unique names. The model receives artifact references, never pixels. The
default artifact store is local; do not configure an uploading artifact
store for private evidence. Captions are literal model-authored text, not
assertions or automatically redacted secrets; do not put secrets in them.
The screenshot provider remains responsible for masking page content.

This is a read-only project tool, not a replayed action. A cached flow can
skip it. Use a separate evidence goal with caching disabled when a fresh
image is required. The native testbed config demonstrates registration;
`tests/annotations.e2e.ts` demonstrates a natural-language request.

## Report acceptance

`@e2e-dev/webdriver/acceptance` exports
`checkAcceptance(report, policy, artifactsRoot)`, returning `{ passed, issues }`.
The `e2e-acceptance <report.json> <policy.json>` CLI returns 0 only when the
declared checks pass, 1 for a rejected report and 2 for unreadable inputs or
incorrect invocation. It never rewrites the original report or evidence.

The policy declares `repeats` and nonempty `cases`. Each case names `file`,
`title` (the title path joined with ` > `), `target`, minimum `screenshots`,
and `steps`. Each step rule names an `api`, `status` (`passed` or `failed`),
an `errorCode` for an expected failure, and optional `minCalls`/`maxCalls`.
There must be exactly one occurrence of each declared step API per attempt.
`minCalls` also requires that many completed model requests and rejects
failed model requests; deliberate protocol-error injection can explicitly
set `allowFailedModelRequests: true`. Omit the minimum for a deliberate
provider-failure or interrupted-request test. Do not relax live-model policy
to conceal a service failure.
An optional top-level `model: { provider, model }` checks model provenance.

The gate refuses skipped required cases, duplicate/missing repeats, retries,
flaky outcomes, cleanup failures, secondary errors, unexpected failed steps
and model vision. Unselected, unexecuted catalogue entries are ignored;
other selected cases must be declared. Serial groups are not supported.
Local screenshots must remain under the real artifact root, belong to the
attempt, match recorded size/SHA-256, declare complete source redaction and
decode as PNG. Screenshot files cannot be shared across artifact entries.

This is a **report-and-PNG gate**, not the complete desktop acceptance
system. It trusts the report producer and trusted screenshot provider; a
hash does not authenticate the report, establish capture freshness or prove
masking was done correctly. It does not validate application isolation,
video decoding, non-PNG attachments or business-file semantics. Required
checks outside this scope need their own validators before overall product
acceptance. See the neutral testbed's `judgments.acceptance.json` and
`mechanisms.acceptance.json` for policies and separate live/scripted suites.

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

File selection and saving accept an optional `windowId`. Omit it to use
the sole enabled, visible dialog of the requested kind in the owned
process. Zero or multiple matches cause a refusal before input, not a
guess. Inspect `native_windows` when disambiguation is needed. Cancellation
still requires an explicit id. This removes the need to ask the model to
look up an id in the single-dialog case; it does not enable cache replay.

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
