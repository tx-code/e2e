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
