# Auditing auth-protected routes (`--login-script`)

The runtime checks (Lighthouse and axe) open each route in a headless Chrome. If your routes
need a logged-in user, give ng-health a **login script**: a small ES module that signs in once
before the runtime checks run.

## How it works

1. ng-health starts Chrome and attaches Playwright to it.
2. Your script's default export is called with a Playwright `page`. Log in with it like a user would.
3. The session (cookies, `localStorage`, `sessionStorage`) lives in the browser's default
   context, which both axe and Lighthouse use. Lighthouse's storage reset is turned off for
   authenticated runs so the session survives.
4. Every configured route is then audited as the logged-in user.

## Writing a script

```js
// login.mjs
export default async function login({ page, context, baseUrl, routes }) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(process.env.E2E_USER);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}
```

| Argument  | Type                        | Description                                             |
| --------- | --------------------------- | ------------------------------------------------------- |
| `page`    | Playwright `Page`           | A fresh tab; it is closed after the script finishes.    |
| `context` | Playwright `BrowserContext` | The shared context, e.g. for `context.addCookies(...)`. |
| `baseUrl` | `string`                    | The audited app's base URL, without a trailing slash.   |
| `routes`  | `string[]`                  | The routes that will be audited.                        |

The script may be `.mjs` or `.js` in an ESM package. It must **wait until login has completed**
(e.g. `waitForURL`) before returning. Token-based apps can skip the UI entirely:

```js
export default async ({ page, baseUrl }) => {
  await page.goto(baseUrl);
  await page.evaluate((t) => localStorage.setItem('access_token', t), process.env.API_TOKEN);
};
```

## Running it

```bash
# against a deployed environment
E2E_USER=… E2E_PASSWORD=… npx ng-health audit --url https://staging.example.com \
  --routes /,/orders,/settings --login-script ./login.mjs

# or in ng-health.config.json (path relative to the config file)
{ "runtime": { "routes": ["/", "/orders"], "loginScript": "./login.mjs" } }
```

A `--login-script` path is resolved from the current directory; a config `loginScript` path is
resolved from the config file's directory.

## Failures and safety

- If the script throws, both runtime checks are reported as **errored** with the script's error
  message; static checks are unaffected.
- A route that still redirects to the login page will be audited as the login page. Check the
  Lighthouse route scores in the report if results look suspiciously good.
- Keep credentials in environment variables or CI secrets, never in the script or config.
- The script runs with your user's permissions on your machine. ng-health sends nothing anywhere;
  only your own app receives the requests.
