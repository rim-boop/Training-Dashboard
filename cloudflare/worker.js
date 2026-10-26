// Cloudflare Workers entry point.
//
// - /api/<name> runs the matching Vercel-style handler from api/ through the adapter.
// - Everything else is a page from dist/ (built by `npm run build:pages`), served by Cloudflare's
//   static assets. Cloudflare serves those files directly; this code only sees requests for
//   paths that aren't a file, which are /api calls and unknown addresses.
//
// Adding a new endpoint: import its handler below and add it to ROUTES.

import { runVercelHandler } from "./adapter.js";
import dashboard from "../api/dashboard.js";
import me from "../api/me.js";
import onboarding from "../api/onboarding.js";
import notionTraining from "../api/notion-training.js";

const ROUTES = {
  dashboard,
  me,
  onboarding,
  "notion-training": notionTraining,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      const name = pathname.slice("/api/".length).replace(/\/$/, "").replace(/\.js$/, "");
      const handler = Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined;
      if (!handler) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      return runVercelHandler(handler, { request, env, ctx });
    }
    return env.ASSETS.fetch(request);
  },
};
