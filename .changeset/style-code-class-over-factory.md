---
"@jaybeeuu/agent-cortex": patch
---

Add a class-over-factory rule to `style-code`: when a module holds mutable state and exposes
methods that transform or manage it, model it as a class with public methods and native
`#private` fields rather than a factory function returning a closure of methods (TypeScript's
`private` modifier is compile-time only). Existing functional guidance for stateless components,
hooks, and pure transforms is unchanged.
