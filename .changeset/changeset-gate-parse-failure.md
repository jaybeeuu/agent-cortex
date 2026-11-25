---
"@jaybeeuu/agent-cortex": patch
---

The Changeset check now fails, naming the changeset file and the reason, when it cannot read the
frontmatter of a changeset the pull request adds or modifies. A changeset with no frontmatter block,
an unclosed block, a frontmatter line with no `package: bump` separator, or an empty file used to
yield no package names, so the workspace check never ran and the gate reported success — while
`changeset version` threw on the same file and failed the Release job on `main`, where nothing can
fix it forward. Valid changesets keep passing, including one that names several packages.
