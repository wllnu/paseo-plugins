# A worked conversion

## Source

> Frontend guidelines. We want a clean, consistent UI. Always use our theme for colors, and don't hardcode spacing either, use the spacing scale (`theme.space`). Try to reuse components from `src/components` before writing new ones. Keep components small. All API calls go through `apiClient`. Never call `fetch` directly in a component. API errors should be shown with `showError`.

## Split and sort

| Candidate | Decision |
| --- | --- |
| "a clean, consistent UI" | Left out. Too vague to decide. |
| Use the theme for colors | Kept as `ui/theme-colors`, error ("always"). |
| Use the spacing scale | Kept as `ui/spacing-scale`, error ("don't"). It shared a sentence with colors, but it is a separate decision. |
| Reuse components from `src/components` | Left out. Needs the other files in `src/components`. |
| Keep components small | Left out. The source gives no size. |
| API calls go through `apiClient`, never `fetch` in a component | Kept as one rule, `api/no-direct-fetch`, error. Both sentences ask for the same thing. |
| Show API errors with `showError` | Kept as `api/show-errors`, warning ("should"). |

## Group

The four kept rules cover two topics. Both apply to components, but API rules will grow on their own, so they get their own ruleset: `ui.md` and `api.md`, each with `paths: src/**/*.tsx`.

## One finished rule

````md
## api/no-direct-fetch
Severity: error
Rule: Make every API call through `apiClient`.
Violated when: a component calls `fetch(` or creates an `XMLHttpRequest`.
Followed when: every request in the changed lines is a call on `apiClient`.

Good:
```tsx
const user = await apiClient.get(`/users/${id}`);
```

Bad:
```tsx
const user = await fetch(`/api/users/${id}`).then((r) => r.json());
```
````

The two criteria name `fetch(`, `XMLHttpRequest` and `apiClient`, so the classifier knows what to look for. The examples are the same request written both ways, so the bad one breaks this rule and nothing else.

## Report to the user

> Wrote `.rules/ui.md` (2 rules) and `.rules/api.md` (2 rules). Both pass validation.
>
> Left out:
> - "We want a clean, consistent UI." Too vague to check.
> - "Try to reuse components from `src/components` before writing new ones." Needs files outside the diff. Worth keeping in AGENTS.md.
> - "Keep components small." No size given. Tell me a line limit and I will add it.
