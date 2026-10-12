---
'@e2e-dev/webdriver': minor
---

Add a report-and-PNG acceptance checker and e2e-acceptance CLI. Require
declared case/repeat coverage, clean attempts, exact expected step outcomes,
optional model-call/provenance checks and readable local PNG evidence with
matching hashes. Keep the original runner verdict unchanged. The checker
does not certify process isolation, video decoding or business-file content.
