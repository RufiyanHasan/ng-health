// Example config in TypeScript: defineConfig gives autocomplete and type checking.
import { defineConfig } from 'ng-health';

export default defineConfig({
  plugins: ['./checks/todo-comments.mjs', './checks/no-console.ts'],
  checks: {
    'custom/todo-comments': { options: { max: 5 } },
  },
  weights: { custom: 5 },
  thresholds: { minOverallScore: 70 },
});
