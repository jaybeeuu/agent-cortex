# User Preferences

This file records personal development preferences for the author (**jaybeeuu**).
Both Copilot CLI agents and PI coding agents should read this file for user-level
context when making tooling and workflow decisions.

## Package manager

| Preference | Value |
|---|---|
| **Preferred tool** | **PNPM** (`pnpm`) over npm (`npm`) |
| Rationale | Faster installs, disk-efficient with content-addressable store, stricter dependency resolution, and built-in workspace support. |
| Impact | Use `pnpm` for installs, script execution, and package management. Use `pnpm dlx` instead of `npx`. Do not suggest `npm install` or `npx` unless the project explicitly uses npm. |

## Future preferences

Add new preferences below as they are established.
