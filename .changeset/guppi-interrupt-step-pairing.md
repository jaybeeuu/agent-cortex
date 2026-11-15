---
"@jaybeeuu/agent-cortex": patch
---

Harden the guppi interrupt render test so a label that no longer sits with its own body fails.

The order assertion read the four step markers by offset, so it proved the markers were ordered and
nothing more. A render could keep every body in place and put the `Record.` label on the rewind
instructions — inverting the record-before-rewind rule the protocol exists to protect — and the test
stayed green.

The test now reads the steps as (label, body) pairs and asserts the pair order, so each label must
carry its own body. No shipped text changed.
