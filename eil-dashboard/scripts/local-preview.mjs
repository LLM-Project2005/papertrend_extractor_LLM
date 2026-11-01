/*
 * Look at a local build of the web app with real data (2026-10-31).
 *
 * The pages come from this machine (`next start` on PREVIEW_APP_PORT, 3001 by
 * default); every /api request goes to a deployed backend (the pilot by
 * default), which shares production's database. So a UI change can be seen
 * with real repositories before anything is deployed, and nothing here talks
 * to the database itself. Sign in as usual: Firebase allows localhost.
 *
 *   npx next build            # with .env.production.local holding the pilot's
 *                             # public NEXT_PUBLIC_* build settings
 *   npx next start -p 3001
 *   node scripts/local-preview.mjs      # then open http://localhost:3000
 *
 * PREVIEW_API_URL picks another backend. Writes made through it are real:
 * they reach the shared database exactly as they would from the pilot.
 */
import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.PREVIEW_PORT || 3000);
const APP_PORT = Number(process.env.PREVIEW_APP_PORT || 3001);
const API = new URL(process.env.PREVIEW_API_URL || "https://papertrend-web-cloudsql-pilot-javhavgdsq-as.a.run.app");

function forward(request, response, target) {
  const remote = target.protocol === "https:";
  const headers = { ...request.headers, host: target.host };
  if (remote) {
    // The backend checks that a request comes from its own site.
    if (headers.origin) headers.origin = target.origin;
    if (headers.referer) headers.referer = target.origin + new URL(headers.referer).pathname;
  }
  const upstream = (remote ? https : http).request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (remote ? 443 : 80),
      method: request.method,
      path: request.url,
      headers,
    },
    (reply) => {
      response.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(response);
    }
  );
  upstream.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end(`local preview: ${remote ? "the backend" : "next start"} did not answer (${error.code || error.message})`);
  });
  request.pipe(upstream);
}

http
  .createServer((request, response) => {
    const toApi = request.url === "/api" || request.url.startsWith("/api/");
    forward(request, response, toApi ? API : new URL(`http://127.0.0.1:${APP_PORT}`));
  })
  .listen(PORT, () => {
    console.log(`local preview on http://localhost:${PORT}: pages from :${APP_PORT}, /api from ${API.origin}`);
  });
