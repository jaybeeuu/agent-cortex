---
"@jaybeeuu/agent-cortex": patch
---

The Changeset check now reads a changeset's frontmatter as release pairs and rejects every release
whose type is not one changesets parses, naming the changeset file and the package. A pair with no
value (`"@jaybeeuu/agent-cortex":`), a quoted empty string, and a misspelled type (`major2`) all
failed `changeset version` on `main` while the gate passed them, because the gate only read the
package name and never the release type it is joined to. The accepted types are `major`, `minor`,
`patch` and `none` — the list `@changesets/parse` accepts, held in one exported constant and
checked as a grammar rather than as another special case.
