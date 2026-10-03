/* firebase-admin/app for route tests (see route-harness.ts): no credentials, no network. */
const app = { name: "[route-tests]" };

export function cert(input: unknown) {
  return input;
}

export function getApps() {
  return [app];
}

export function initializeApp() {
  return app;
}
