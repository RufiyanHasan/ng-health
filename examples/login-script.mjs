// Example ng-health login script.
// Usage: ng-health audit --url https://staging.example.com --routes /,/orders --login-script ./login.mjs
// or set "runtime": { "loginScript": "./login.mjs" } in ng-health.config.json.

/** @param {{ page: import('playwright-core').Page, baseUrl: string, routes: string[] }} args */
export default async function login({ page, baseUrl }) {
  // Never hard-code credentials: read them from the environment (CI secrets).
  const user = process.env.E2E_USER;
  const password = process.env.E2E_PASSWORD;
  if (!user || !password) throw new Error('Set E2E_USER and E2E_PASSWORD');

  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(user);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}
