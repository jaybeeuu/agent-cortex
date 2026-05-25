# Performance Checklist

Before finalizing changes:

- Keep work scoped; avoid unnecessary I/O and scans.
- Prefer batched tool calls for independent operations.
- Avoid repeated expensive commands when one run is sufficient.
- Verify changed paths only when possible.
