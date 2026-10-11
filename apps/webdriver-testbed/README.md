# WebDriver testbed

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
