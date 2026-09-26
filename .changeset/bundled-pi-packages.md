---
"@jaybeeuu/agent-cortex": minor
---

Bundle the required pi packages instead of provisioning them. `pi-questions`
(`ask_questions`) and `pi-web-access` (`fetch_content`) are now real `dependencies` shipped
inside the published tarball and referenced through `node_modules/...` in the package's `pi`
manifest, so a clean `~/.pi` gets the tools with no separate `pi install` and no
`agent-cortex install pi` provisioning step. `package.json` `pi.packages`,
`lib/pi-packages.mjs`, and the `--no-provision` flag are gone; the template
`pi/settings.json` now declares only the optional packages, with its skills filter widened to
`["node_modules/**"]` so bundled package skills still load. The repo's `.npmrc` sets
`node-linker=hoisted`, which pnpm requires for `bundledDependencies`.
