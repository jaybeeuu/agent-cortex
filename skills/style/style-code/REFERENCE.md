# Examples

Before/after pairs for `style-code`. The most common patterns come first; the rest are
extended pairs for less frequent cases.

## Common patterns

### Types at boundaries

| Instead of… | Write… |
|---|---|
| `function handleRequest(raw: any) { ... }` with no validation | `function handleRequest(raw: unknown): HandlerResult { ... }` validated at the ingress boundary |
| `const user = JSON.parse(raw)` with unchecked cast | `const user = parseUser(JSON.parse(raw))` validated with `parseUser` at the deserialisation edge |

### Naming

| Instead of… | Write… |
|---|---|
| `function process(items) { ... }` | `function resolveOverdueAccounts(accounts: Account[]) { ... }` |
| `interface Config { ... }` | `interface ExportOptions { ... }` |

### Scoping

| Instead of… | Write… |
|---|---|
| One commit fixing a bug, renaming a module, and adding an abstraction | One commit per concern, each reviewable on its own |

### Stateful objects

| Instead of… | Write… |
|---|---|
| ```ts // factory closure hiding mutable state function createStepRegistry() { const steps = new Map<string, Step>(); return { register: (name, step) => steps.set(name, step), resolve: (name) => steps.get(name), }; } ``` | ```ts // a class names the state it owns class StepRegistry { #steps = new Map<string, Step>(); register(name: string, step: Step): void { this.#steps.set(name, step); } resolve(name: string): Step \| undefined { return this.#steps.get(name); } } ``` |
| ```ts class C { private steps = new Map<string, Step>(); } ``` (compile-time only — erases away) | ```ts class C { #steps = new Map<string, Step>(); } ``` (runtime-enforced native private field) |

## Validation and error handling

| Instead of… | Write… |
|---|---|
| ```ts function process(input: any) { // assume it's correct } ``` | ```ts function process(input: unknown): ProcessResult { const data = parseInput(input); // validated at system edge } ``` |
| ```ts throw "invalid"; ``` | ```ts throw new ValidationError({ field: "email", reason: "missing @" }); ``` |

## Module structure

| Instead of… | Write… |
|---|---|
| `actions/`, `reducers/`, `selectors/`, `thunks/` — grouped by technical type | `accounts/`, `payments/`, `notifications/` — each with its own types, actions, reducers, selectors, thunks |
| `utils/` with fifty unrelated helpers | Feature-specific modules (`accounts/resolve-overdue.ts`, `accounts/export-csv.ts`) |
| `shared/types.ts` with every type | Types co-located in the owning package, exported from `index.ts` |

## State management

| Instead of… | Write… |
|---|---|
| ```ts let count = 0; function inc() { count++; } ``` (shared mutable state) | ```ts const [count, setCount] = useState(0); // explicit, local, testable ``` |
| Async state stored as separate booleans | ```ts type AsyncState<T> = { status: "idle" \| "loading" \| "success"; data?: T; error?: Error }; ``` |

## Component structure

| Instead of… | Write… |
|---|---|
| ```ts function Page() { const [data, setData] = useState(null); useEffect(...); return <div>...</div>; } ``` (data loading + rendering) | Split into `usePageData()` hook and `Page` component with explicit props |

## Public API conventions

| Instead of… | Write… |
|---|---|
| Default export from module | Named exports from `index.ts` for the intended public API |
| ```ts export function x(a, b, c) { ... } ``` with undocumented params | ```ts export function createReport(options: ReportOptions): Report { ... } ``` with documented `ReportOptions` interface |
