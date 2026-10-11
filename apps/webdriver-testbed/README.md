# WebDriver testbed

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
```

It opens an owned Windows file dialog, selects a registered text file,
checks the dialog's returned path, and verifies that an unknown file,
unowned window and changed process identity are refused. The cancel run
checks the dialog's Cancel result. The fixture writes only under `.e2e-native`.
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
