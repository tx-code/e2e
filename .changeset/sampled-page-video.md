---
'@e2e-dev/webdriver': minor
---

Support opt-in page-only MP4 recording through the existing e2e video
artifact contract. Sample trusted masked screenshots at a bounded rate,
encode locally with a configured FFmpeg executable, preserve elapsed frame
times, and remove owned temporary frames on teardown. Reject incomplete
recordings on masking, capture, viewport-size or encoding failures.
