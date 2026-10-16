// Shared code for the API routes. Files starting with "_" are not exposed as routes by Vercel.
//
// Environment variables:
//   NOTION_TOKEN     Notion integration secret. Needs "Read content" and "Insert content".
//   TEAM_DB, TRAININGS_DB, COMPLETIONS_DB, QUESTIONS_DB   database IDs
//   TIMEZONE         optional, for "today" when saving a quiz (default Asia/Dubai)

export const PROPS = {
  team: {
    name: "Name", role: "Role", status: "Employment Status", hireDate: "Hire Date",
    key: "Access Key", extra: "Extra Trainings",
  },
  trainings: {
    name: "Item", roles: "Relevant Role", frequency: "Frequency (months)", category: "Category",
    passMark: "Pass Mark (%)", material: "Material Link",
  },
  completions: {
    title: "Record", employee: "Employee", training: "Training", completed: "Completed On",
    signed: "Manager Signed On", score: "Score (%)", result: "Result", source: "Source", answers: "Answers",
  },
  questions: {
    question: "Question", training: "Training", a: "Option A", b: "Option B", c: "Option C", d: "Option D",
    correct: "Correct Answer", order: "Order",
  },
};

export const DEFAULT_PASS_MARK = 80;
export const DUE_SOON_DAYS = 60;
const NOTION_VERSION = "2022-06-28";

export class NotionError extends Error {
  constructor(status, detail) { super(`Notion returned ${status}`); this.status = status; this.detail = detail; }
}

async function notion(path, method, body) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new NotionError(r.status, await r.text());
  return r.json();
}

export async function queryAll(databaseId, filter) {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    if (filter) body.filter = filter;
    const data = await notion(`databases/${databaseId}/query`, "POST", body);
    rows.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return rows;
}

export function createPage(databaseId, properties) {
  return notion("pages", "POST", { parent: { database_id: databaseId }, properties });
}

// Read any Notion property as a simple value.
export function val(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case "title":
    case "rich_text":
      return p[p.type].map((t) => t.plain_text).join("").trim() || null;
    case "select": return p.select?.name ?? null;
    case "status": return p.status?.name ?? null;
    case "multi_select": return p.multi_select.map((o) => o.name);
    case "number": return p.number;
    case "url": return p.url;
    case "date": return p.date?.start ? p.date.start.slice(0, 10) : null;
    case "relation": return p.relation.map((r) => r.id);
    case "people": return p.people.map((u) => u.name || u.id);
    case "checkbox": return p.checkbox;
    case "formula": { const f = p.formula; return f[f.type]?.start ?? f[f.type] ?? null; }
    case "rollup": {
      const r = p.rollup;
      if (r.type === "date") return r.date?.start ?? null;
      if (r.type === "number") return r.number;
      return null;
    }
    default: return null;
  }
}

// ---------- mapping Notion pages to plain objects ----------
export function toStaff(p) {
  const T = PROPS.team;
  return {
    id: p.id, url: p.url,
    name: val(p, T.name) || "Unnamed",
    role: val(p, T.role),
    status: val(p, T.status),
    hireDate: val(p, T.hireDate),
    extra: val(p, T.extra) || [],
  };
}
export function toTraining(p) {
  const R = PROPS.trainings;
  const mat = val(p, R.material);
  return {
    id: p.id, url: p.url,
    name: val(p, R.name) || "Untitled training",
    roles: val(p, R.roles) || [],
    frequency: val(p, R.frequency) ?? 0,
    category: val(p, R.category),
    passMark: val(p, R.passMark) ?? DEFAULT_PASS_MARK,
    material: typeof mat === "string" && /^https:\/\//.test(mat) ? mat : null,
  };
}
export function toRecord(p) {
  const C = PROPS.completions;
  return {
    id: p.id, url: p.url, createdAt: p.created_time,
    employeeId: (val(p, C.employee) || [])[0] || null,
    trainingId: (val(p, C.training) || [])[0] || null,
    completed: val(p, C.completed),
    signed: val(p, C.signed),
    score: val(p, C.score),
    result: val(p, C.result),
    source: val(p, C.source),
  };
}

// ---------- compliance logic (the admin page has an identical copy) ----------
export function parseDate(s) { if (!s) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export function addMonths(date, n) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + n, d = date.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last)));
}
export function isoDay(d) { return d.toISOString().slice(0, 10); }
export function todayIn(tz) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: tz || process.env.TIMEZONE || "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return s; // YYYY-MM-DD
}

export function applies(staff, training) {
  return training.roles.includes("All Staff")
    || (staff.role && training.roles.includes(staff.role))
    || staff.extra.includes(training.id);
}

// A record counts as a pass if it says so, or (for older records with no result) if it has no score or the score meets the pass mark.
export function isPass(rec, training) {
  if (rec.result) return rec.result === "Passed";
  if (rec.score == null) return true;
  return rec.score >= training.passMark;
}

// Status for one person and one training. today is "YYYY-MM-DD".
export function statusFor(staff, training, records, today) {
  if (!applies(staff, training)) return { status: "na" };
  const attempts = records
    .filter((r) => r.employeeId === staff.id && r.trainingId === training.id && r.completed)
    .sort((a, b) => a.completed.localeCompare(b.completed) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const last = attempts[attempts.length - 1] || null;
  const base = { attempts: attempts.length, last };
  if (!last) return { ...base, status: "missing" };
  if (!isPass(last, training)) return { ...base, status: "retake" };
  const now = parseDate(today);
  const done = parseDate(last.completed);
  const due = training.frequency > 0 ? addMonths(done, training.frequency) : null;
  const days = due ? Math.round((due - now) / 86400000) : null;
  const status = due == null ? "ok" : days < 0 ? "late" : days <= DUE_SOON_DAYS ? "soon" : "ok";
  return { ...base, status, done: last.completed, due: due ? isoDay(due) : null, days, needsSignoff: !last.signed };
}

export function sendNotionError(res, e) {
  const s = e?.status;
  const message =
    s === 404 ? "Notion couldn't find one of the databases. Check the database IDs in Vercel and that the integration is connected to the Demo Data page."
    : s === 401 ? "Notion rejected the integration secret. Check NOTION_TOKEN in Vercel."
    : s === 403 ? "The Notion key isn't allowed to do this. In the integration's settings, turn on Insert content, then redeploy."
    : s === 400 ? "Notion refused the request. A property name in Notion may have changed."
    : "Notion couldn't be reached. Try again in a minute.";
  return res.status(s && s < 500 ? 502 : 503).json({ error: "notion_error", message });
}
