# WebDriver testbed

## Reproducible environment check

From the repository root, install the locked workspace dependencies and
build the two packages directly with Corepack. Do not use `--force` or an unrelated global pnpm shim:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --filter e2e run build
corepack pnpm --filter @e2e-dev/webdriver run build
```

Install Edge and a matching EdgeDriver separately. Set its explicit path,
then run the check from this directory (replace the example path):

```powershell
$env:WEBDRIVER_EDGE_DRIVER='C:\test-tools\msedgedriver.exe'
node setup-check.mjs
```

This checks Node, built package versions and ordinary source-newer-than-dist
edits, probes the driver, then runs two neutral cases three times and checks
their report/PNG evidence and clean attempts. Build freshness uses local
timestamps, not a cryptographic source attestation. Evidence goes into a
new `.e2e-setup-check-*` directory each time. No model calls, browser downloads,
package installs, global PATH changes or daily application shutdowns occur
inside this command. Missing or mismatched prerequisites fail at a named stage.

Use `--preflight-only` to skip browser smoke. Use `--video` to additionally
require FFmpeg with libx264 and request video artifacts; `FFMPEG_PATH` can
select its executable. Video decoding is not certified by this check.
Model login and Tauri application isolation remain separate requirements.

The native and standard configs now require the explicit driver variable;
they no longer fall back to Selenium Manager. Browser/driver versions and
driver hash are recorded in the attempt environment.

Core Playwright suites are a different environment. If their pinned Chromium
is missing, install it explicitly when network access is available, preserving
other tools' browser caches:

```powershell
$env:PLAYWRIGHT_SKIP_BROWSER_GC='1'
node packages/web/dist/bin.js install chromium
```

Run that last command from the repository root. It intentionally downloads
a browser; `setup-check.mjs` never runs it automatically.

## Judgment capability acceptance

The live suite uses the stored subscription login with `gpt-6-astra`,
semantic inputs only, cache off and retries disabled. It declares eight
cases: true/false/inconclusive assertions, correct/missing extraction,
delayed readiness, static-page timeout and call-budget exhaustion. The
fixture controls the state; fixed literal/locator checks provide the answer,
not another model. Negative cases catch only their declared error code.

```bash
node node_modules/e2e/dist/cli/bin.js run tests/judgments.e2e.ts --config e2e.judgments.config.ts --repeat-each 3 --output .e2e-judgments --reporter list,junit,markdown
node node_modules/@e2e-dev/webdriver/dist/acceptance-cli.js .e2e-judgments/report.json judgments.acceptance.json
```

Each assertion/extraction has a 30-second limit. Waiting uses at most four
model calls (one in the budget-exhaustion case); the static timeout is 12
seconds. The policy requires three results per case and checks expected
step errors, model provenance and local screenshots. It does not rerun
failures or choose the best repeat. These are smoke results, not a production
accuracy estimate. Red negative `agent.*` step lines are expected; the outer
test passes only when the declared error and independent checks match.

Mechanism tests are separate and use **scripted responses**, not a live
model. They exercise one repair, invalid output after repair, provider
failure, deadline enforcement, extraction schema repair and an independent
assertion rejecting schema-valid but factually wrong data through real
Edge/WebDriver. Their displayed token usage is synthetic.

```bash
node node_modules/e2e/dist/cli/bin.js run tests/mechanisms.e2e.ts --config e2e.mechanisms.config.ts --output .e2e-mechanisms --reporter list,junit,markdown
node node_modules/@e2e-dev/webdriver/dist/acceptance-cli.js .e2e-mechanisms/report.json mechanisms.acceptance.json
```

Keep the two reports separate. The gate currently covers report and PNG
integrity, not complete process isolation, video decoding or CAM data
correctness. Existing core Playwright integration tests still need their
specified Chromium installation; this WebDriver suite does not stand in
for those tests.

`screenshots.acceptance.json` also checks the existing screenshot suite.
With `--video`, its secure-input refusal case causes video cleanup to fail:
the raw test can remain green, but the acceptance CLI must exit 1. This is
a regression check for the distinction between runner verdict and complete
report evidence, not a reason to permit unmasked screenshots.

## Page recordings

Both configs declare sampled page video at 2 fps. Install FFmpeg with
`libx264` on PATH, or set `FFMPEG_PATH` to its executable. Add `--video` to
the CLI command for `tests/controls.e2e.ts` or the native agent flow to
record; without the flag no recording occurs. The report links a local MP4
and step times. File dialogs and the desktop are not in the video.

`tests/failure.e2e.ts --video` verifies that failed assertions keep video.
`tests/screenshots.e2e.ts --video` exercises a masking refusal: the secure
input test keeps its passed assertions but reports failed evidence cleanup
and has no MP4. This distinction is intentional in the runner's verdict
contract; consumers must inspect cleanup errors, not only exit codes.

## Local screenshot checkpoints

The native config also registers `annotate_screenshot`. Run
`tests/annotations.e2e.ts` with `--config e2e.native.config.ts` to ask the
agent to mark two page controls with Chinese captions. The trace links the
original and the annotated PNG at the tool's step. No screenshot pixels
are sent to the model. The test checks that page values were not changed.
`tests/annotations-failure.e2e.ts` requests a missing target and is expected
to fail without producing any annotated PNG. Run it separately with the
same config to exercise the refusal path.

`tests/screenshots.e2e.ts` captures before a change and after its assertion,
and checks that the provider refuses password fields. The native agent flow
also captures before Open/Save and after saved-content verification. Run
`tests/failure.e2e.ts` separately to verify automatic failure capture; its
exit code must be 1.

Screenshots appear in the local attempt artifacts and are linked from the
report's trace. They show the page viewport, not native dialogs or the
desktop, and are not sent to the model. The testbed's provider is restricted
to its owned non-sensitive page, not a reusable application masking policy.
All `.e2e*` evidence directories remain ignored by Git.

This project consumes the built e2e and WebDriver packages. Its page is an
independent form with native inputs, a select, a checkbox, and a field that
can be replaced. No model or product-specific application is required.

Build the packages, set `WEBDRIVER_EDGE_DRIVER` to a matching EdgeDriver if
Selenium Manager cannot install one, and run the built CLI from this directory:

```sh
node node_modules/e2e/dist/cli/bin.js run tests/controls.e2e.ts --repeat-each 3 --reporter list,junit,markdown
```

`tests/failure.e2e.ts` is an intentional failure. Run it separately to verify
exit code 1, the failure trace, and screenshot artifacts. A successful
verification of that file means it fails with the expected assertion.

The normal project script selects only the controls tests. Screenshots are
available only on the owned page without secure fields or nested frames.

## Agent replay measurements

`e2e.cache.config.ts` uses a subscription model on this neutral page. It needs
the AI SDK and its OpenAI adapter as runtime peers of e2e, even though the
config imports the model constructor through `e2e/oauth/chatgpt`. These
indirect peers are excluded from the repository's static dependency check.

Run `e2e login openai`, then select the cache test explicitly:

```sh
node node_modules/e2e/dist/cli/bin.js run tests/cache.e2e.ts --config e2e.cache.config.ts --repeat-each 5 --output .e2e-benchmark --reporter list,junit,markdown
```

The first verified goal writes a replay entry. Later attempts use fresh
driver sessions and the same goal. Set `CHANGED_CONTROL=1` to change the
submit control's name and id without changing the test. A stale recording
must hand control back to the model. Use a separate output directory for
that run. To measure another cold start, choose a new, empty `cache.dir`
in the config; changing `--output` does not clear the replay cache.

Read model usage and cache outcomes from `report.json`, and operation timing
from `webdriver.metrics` app-log entries. `agent.act` duration includes model
latency, action dispatch, and verification. It is not a DOM-query benchmark.

Summarize one or more reports without modifying the originals:

```sh
node summarize-benchmark.mjs .e2e-benchmark/report.json
```

## Reporter diagnostics

The reporter fixture uses a deterministic executor and no model service.
One passing test deliberately uses a plain-value assertion; the other uses
a locator assertion. Run both twice to check that only the verified goal
replays and that the summary explains the unconfirmed recordings:

```sh
node node_modules/e2e/dist/cli/bin.js run tests/report-diagnostics.e2e.ts --config e2e.report.config.ts --repeat-each 2 --output .e2e-report-diagnostics --reporter list,junit,markdown
```

## Native Windows dialogs

After building the engine, run the independent native fixture:

```sh
node native-dialog-check.mjs
node native-dialog-check.mjs --classic
node native-dialog-check.mjs --save
node native-dialog-check.mjs --save --classic
node native-dialog-check.mjs --cancel
node native-dialog-check.mjs --foreign
node native-dialog-check.mjs --error
node native-dialog-check.mjs --auto
node native-dialog-check.mjs --auto --save
node native-dialog-check.mjs --auto --classic
node native-dialog-check.mjs --auto --save --classic
node native-dialog-check.mjs --multiple
```

It opens an owned Windows file dialog, selects a registered text file,
checks the dialog's returned path, and verifies that an unknown file,
unowned window and changed process identity are refused. The cancel run
checks the dialog's Cancel result. The fixture writes only under `.e2e-native`.

`--auto` omits the window id for file operations. Each run also checks that
the opposite dialog kind is refused. `--multiple` opens two independent
Open dialogs in one owned process, checks that automatic selection refuses
the ambiguity without closing either, then cancels both explicitly.
The foreign-window check opens a second owned fixture and proves the first
tool pack cannot select a file in its dialog. Fixture names include spaces
and Unicode characters.
The error-dialog check reads a native error message, refuses file selection
in that window, and dismisses it.
The save checks verify the returned destination and actual file contents,
reject overwriting an existing file, and confirm the original stays unchanged.

The real agent test uses the same subscription login as the replay test:

```sh
node node_modules/e2e/dist/cli/bin.js run tests/native.e2e.ts --config e2e.native.config.ts --output .e2e-native-agent --reporter list,junit,markdown
```

The agent opens the registered file, saves a copy through Save As, and fills
the web form. The test checks both returned paths, saved content, original
content and the web field. Add `--repeat-each 3 --max-failures 1` to check
repeatability with fresh sessions and destinations. This test has the cache
off because native mutating tools are replay gaps.
