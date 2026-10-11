---
'@e2e-dev/webdriver': patch
---

Allow native Open and Save As tools to omit windowId when exactly one
enabled matching dialog belongs to the owned process. Refuse zero or
multiple matches before input, and reject disabled explicit targets.
Cancellation still requires an explicit window id. Mutating native tools
remain cache replay gaps.
