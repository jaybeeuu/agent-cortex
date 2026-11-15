---
"@jaybeeuu/agent-cortex": patch
---

Harden the guppi interrupt render test so a label that no longer sits with its own body fails.

The order assertion read the four step markers by offset, and the marker was the label, so the test
proved the four labels were ordered and nothing more. A render could keep every label in place and
exchange the two bodies — the record's text under `Rewind.`, the rewind's under `Record.` — inverting
the record-before-rewind rule the protocol exists to protect, and the test stayed green.

The test now reads the steps as (label, body) pairs and asserts the pair order, so each label must
carry its own body. No shipped text changed.
