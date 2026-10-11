---
'@e2e-dev/webdriver': minor
---

Add Windows native dialog tools for process-scoped inspection, registered
file selection, Save As destinations, file metadata, and dialog cancellation. Validate the process creation
time and dialog owner before input. Custom mutating tools remain replay
gaps under the runner's existing cache rules. Refuse existing save paths
and support fresh destinations per attempt.
