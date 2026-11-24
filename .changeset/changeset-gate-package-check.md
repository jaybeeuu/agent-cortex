---
"@jaybeeuu/agent-cortex": patch
---

The Changeset check now resolves the package names an added changeset's frontmatter bumps against
the pnpm workspace. A name the workspace does not declare fails the gate at the pull request,
naming both the changeset file and the package — the shape that let two changesets name
`@cryptolibertus/agent-cortex`, pass the gate twice, and break `changeset version` in the Release
job on `main` twice. The workspace is read from `pnpm-workspace.yaml` and the packages it declares,
without an install, because the gate runs on a bare CI checkout where no package manager is
available. Patch, minor, major and multi-line bodies all keep passing.
