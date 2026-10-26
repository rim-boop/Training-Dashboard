// Runs the Vercel-style handlers in api/*.js on Cloudflare Pages Functions.
//
// The handlers were written for Vercel: handler(req, res) with req.method / req.query /
// req.body / req.headers and res.setHeader / res.status(..).json(..). This file builds
// those two objects from Cloudflare's Request, runs the handler unchanged, and turns
// what it wrote into a Cloudflare Response. The handlers themselves are not modified,
// so the same code still deploys to Vercel.

function loadEnv(env) {
  // The handlers read settings from process.env. On Cloudflare they arrive in context.env.
  if (typeof globalThis.process === "undefined") globalThis.process = { env: {} };
  if (!globalThis.process.env) globalThis.process.env = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === "string") globalThis.process.env[k] = v;
  }
}

async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const type = request.headers.get("content-type") || "";
  const text = await request.text();
  if (!text) return undefined;
  if (type.includes("application/json")) {
    try { return JSON.parse(text); } catch { return undefined; } // Vercel also leaves bad JSON unparsed
  }
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  return text;
}

export async function runVercelHandler(handler, context) {
  const { request, env } = context;
  loadEnv(env);

  const url = new URL(request.url);
  const query = {};
  for (const [k, v] of url.searchParams) {
    query[k] = k in query ? [].concat(query[k], v) : v; // repeated keys become an array, like Vercel
  }
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  const req = { method: request.method, url: url.pathname + url.search, query, headers, body: await readBody(request) };

  const out = { status: 200, headers: new Headers(), body: null, sent: false };
  const res = {
    statusCode: 200,
    setHeader(k, v) { out.headers.set(k, Array.isArray(v) ? v.join(", ") : String(v)); return this; },
    getHeader(k) { return out.headers.get(k); },
    status(code) { out.status = code; this.statusCode = code; return this; },
    json(obj) {
      if (!out.headers.has("content-type")) out.headers.set("content-type", "application/json; charset=utf-8");
      out.body = JSON.stringify(obj); out.sent = true; return this;
    },
    send(data) {
      if (data !== null && typeof data === "object") return this.json(data);
      out.body = data == null ? "" : String(data); out.sent = true; return this;
    },
    end(data) { if (data != null) out.body = String(data); out.sent = true; return this; },
  };

  try {
    await handler(req, res);
  } catch (e) {
    console.error(e); // shows in Cloudflare's logs
    // Same shape the handlers use for their own errors, so the pages can show a message.
    return new Response(JSON.stringify({ error: "server_error", message: "Something went wrong. Reload the page and try again." }), {
      status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!out.sent) return new Response(null, { status: out.status === 200 ? 204 : out.status, headers: out.headers });
  return new Response(out.body, { status: out.status, headers: out.headers });
}
