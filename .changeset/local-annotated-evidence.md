---
'@e2e-dev/webdriver': minor
---

Add screenshotAnnotationTools through the annotations entry point. Agents
can attach an original viewport PNG and a numbered, captioned copy using
exact semantic targets. Keep rendering local and return artifact references,
not image bytes. Reject ambiguous, stale, covered and offscreen targets,
layout changes, and incompatible screenshot dimensions.
