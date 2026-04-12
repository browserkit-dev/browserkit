---
"@browserkit-dev/core": patch
---

Refactor internal browser session management into a `BrowserBackend` strategy pattern. Each auth strategy (`persistent`, `storage-state`, `cdp-attach`, `extension`) is now a self-contained class implementing a `BrowserBackend` interface. No behavior change — public API is unchanged.
