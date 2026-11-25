---
"@jaybeeuu/agent-cortex": patch
---

Thread scopes parameter through readQueue, buildShortlist, and buildRecommendation so shortlist and recommend tests do not read the machine's scopes.json. Update both test files to pass a single controlled scope, closing the defect where tests failed on machines with multiple scopes configured.
