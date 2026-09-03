# Additional Examples

Extended before/after pairs for less common style-code patterns.

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
