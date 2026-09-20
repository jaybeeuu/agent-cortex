---
"@jaybeeuu/agent-cortex": patch
---

The bundled `agent-modes` pi extension now registers its `--agent <name>` CLI flag while the extension loads, instead of from its `session_start` handler. PI validates parsed CLI flags against the extensions present at startup, so the late registration meant `pi --agent <name>` failed with `Unknown option: --agent`. Registration is extracted into a `registerAgentFlag(pi, agents)` helper called directly by the extension factory.
