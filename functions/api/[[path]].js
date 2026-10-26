// Cloudflare Pages route for everything under /api/.
// Sends each request to the same handler file Vercel uses, through the adapter.
// Adding a new endpoint: import its handler below and add it to ROUTES.

import { runVercelHandler } from "../_adapter.js";
import dashboard from "../../api/dashboard.js";
import me from "../../api/me.js";
import onboarding from "../../api/onboarding.js";
import notionTraining from "../../api/notion-training.js";

const ROUTES = {
  dashboard,
  me,
  onboarding,
  "notion-training": notionTraining,
};

export async function onRequest(context) {
  const parts = Array.isArray(context.params.path) ? context.params.path : [context.params.path];
  const name = (parts[0] || "").replace(/\.js$/, "");
  const handler = parts.length === 1 ? ROUTES[name] : undefined;
  if (!handler) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  }
  return runVercelHandler(handler, context);
}
