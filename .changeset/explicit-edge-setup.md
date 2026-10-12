---
'@e2e-dev/webdriver': minor
---

Add explicit Edge driver preflight, a bounded owned-session factory and an
offline doctor CLI. Never use automatic driver discovery in this factory.
Release sessions when initialization fails or is cancelled, and refuse
engine reuse after resource cleanup fails. Add a no-model testbed setup
check that verifies builds, preflights the driver and repeats smoke tests.
