/*
 * The product, with an invented research collection instead of anyone's data.
 *
 * The marketing screenshots and clips are recorded from the real app. While
 * they are, every request to /api/ is answered here from fixtures.json: an
 * invented repository ("Coastal Adaptation Review", 41 papers on coastal
 * climate adaptation) whose structure was modelled on real responses and whose
 * every title, topic, keyword, sentence, name and id was replaced. The paper
 * the clips open is star.pdf, written so its evidence sentences are in its text.
 *
 * Anything this file does not know is refused (and logged), never passed
 * through, so a recording cannot show real data by accident. Only sign-in
 * itself reaches the real service.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Route } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));

export type Fixtures = Record<string, any>;

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(join(HERE, "fixtures.json"), "utf8"));
}

const MOCK_PDF_ORIGIN = "https://mock.papertrend.test/";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function sse(events: Array<{ event: string; data: unknown }>): string {
  return events.map((item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`).join("");
}

export async function installMockApi(
  context: BrowserContext,
  fixtures: Fixtures,
  options: { chatDelayMs?: number; onUnknown?: (method: string, path: string) => void } = {}
) {
  const pdf = readFileSync(join(HERE, "star.pdf"));

  await context.route((url) => url.href.startsWith(MOCK_PDF_ORIGIN), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: pdf,
      headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
    })
  );

  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/profile" && method === "GET") return json(route, fixtures.profile);
    if (path === "/api/workspace/projects" && method === "GET") return json(route, fixtures.projects);
    if (path === "/api/workspace/organizations") return json(route, fixtures.organizations);
    if (path === "/api/workspace/folders") return json(route, fixtures.folders);
    if (/^\/api\/workspace\/projects\/[^/]+\/analysis-profile$/.test(path)) return json(route, fixtures.analysis_profile);
    if (path === "/api/workspace/library" && method === "GET") return json(route, fixtures.library);
    if (/^\/api\/workspace\/library\/[^/]+\/analysis$/.test(path)) return json(route, fixtures.analysis);
    if (/^\/api\/workspace\/library\/[^/]+$/.test(path) && method === "POST") {
      return json(route, { url: `${MOCK_PDF_ORIGIN}papers/star.pdf` });
    }
    if (path === "/api/workspace/dashboard-data") return json(route, fixtures.dashboard);
    if (path === "/api/workspace/semantic-map") return json(route, fixtures.semantic_map);
    if (path === "/api/chat/scope-summary") return json(route, fixtures.scope_summary);
    if (path === "/api/chat/threads" && method === "GET") {
      const query = url.searchParams.get("q")?.toLowerCase().trim();
      if (query) {
        const results = fixtures.threads.threads
          .filter((thread: { title: string }) => thread.title.toLowerCase().includes(query))
          .map((thread: unknown) => ({ thread, messages: [] }));
        return json(route, { results });
      }
      return json(route, fixtures.threads);
    }
    if (/^\/api\/chat\/threads\/[^/]+$/.test(path) && method === "GET") return json(route, fixtures.thread_detail);
    if (path === "/api/chat" && method === "POST") {
      // A pause while the orb works, then the finished answer, as the real
      // stream ends: progress frames, then one result frame.
      await new Promise((resolve) => setTimeout(resolve, options.chatDelayMs ?? 2600));
      const detail = fixtures.thread_detail;
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([
          { event: "progress", data: { stage: "retrieving", label: "Searching your papers", at: Date.now() } },
          { event: "progress", data: { stage: "synthesizing", label: "Writing the answer", at: Date.now() } },
          {
            event: "result",
            data: { ...fixtures.chat_answer, thread: detail.thread, messages: detail.messages, mode: "grounded" },
          },
        ]),
      });
    }

    options.onUnknown?.(method, path);
    return json(route, { error: "Not available in the demo recording." }, 404);
  });
}

/*
 * A drawn pointer, since a headless browser has none. It follows the mouse
 * the scene moves, dips when it clicks, and reads on light and dark pages.
 */
export const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById("mock-cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "mock-cursor";
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L16 21l-3.2 1.4-3.6-8.1L4 18.6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-100px,-100px)", transition: "transform 0ms", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.25))" });
    document.documentElement.appendChild(cursor);
    let x = -100, y = -100, pressed = false;
    const paint = () => { cursor.style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px) scale(" + (pressed ? 0.88 : 1) + ")"; };
    window.addEventListener("mousemove", (event) => { x = event.clientX; y = event.clientY; paint(); }, true);
    window.addEventListener("mousedown", () => { pressed = true; paint(); }, true);
    window.addEventListener("mouseup", () => { pressed = false; paint(); }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();
`;
