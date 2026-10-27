# Example: custom checks

Two custom checks and the config that registers them:

| File                       | What it shows                                                                     |
| -------------------------- | --------------------------------------------------------------------------------- |
| `checks/todo-comments.mjs` | A plain JavaScript check with an option (`max`) and its own score.                |
| `checks/no-console.ts`     | A TypeScript check: ng-health loads `.ts` plugins directly, without a build step. |
| `ng-health.config.ts`      | A TypeScript config using `defineConfig`, registering both plugins.               |

Try it in an Angular project:

```bash
npm install --save-dev ng-health
# copy checks/ and ng-health.config.ts from this folder into the project root, then:
npx ng-health audit . --only custom
```

Paths in `plugins` are relative to the config file. Package names (`"ng-health-plugin-x"`)
are resolved from the project's `node_modules`.

Every check needs `id` (`category/name`), `name`, `category` and `run(ctx)`, which returns
`{ findings, score? }`. ng-health validates plugins when it loads them and names the exact
problem, for example: `Plugin "./checks/x.mjs" does not export a valid check: its check:
"run" must be a function`.
