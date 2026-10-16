// Shared code for the API routes. Files starting with "_" are not exposed as routes by Vercel.
//
// Environment variables:
//   NOTION_TOKEN     Notion integration secret. Needs "Read content" and "Insert content".
//   TEAM_DB, TRAININGS_DB, COMPLETIONS_DB, QUESTIONS_DB   database IDs
//   TIMEZONE         optional, for "today" (default Asia/Dubai)

export const PROPS = {
  team: {
    name: "Name", role: "Role", status: "Employment Status", hireDate: "Hire Date",
    linkKey: "Link Key", extra: "Extra Trainings",
  },
  trainings: {
    name: "Item", roles: "Relevant Role", frequency: "Frequency (months)", category: "Category",
    passMark: "Pass Mark (%)", material: "Material Link",
    completion: "Completion", signoff: "Manager Sign-off", version: "Version",
  },
  completions: {
    title: "Record", employee: "Employee", training: "Training", completed: "Completed On",
    signed: "Manager Signed On", score: "Score (%)", result: "Result", source: "Source",
    answers: "Answers", version: "Version",
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
    completion: val(p, R.completion) === "Quiz" ? "Quiz" : "Read & confirm",
    needsSignoff: val(p, R.signoff) === true,
    version: val(p, R.version),
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
    version: val(p, C.version),
  };
}

// ---------- compliance logic: used by both the employee page and the manager dashboard ----------
export function parseDate(s) { if (!s) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export function addMonths(date, n) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + n, d = date.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last)));
}
export function isoDay(d) { return d.toISOString().slice(0, 10); }
export function todayIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || process.env.TIMEZONE || "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function byRole(staff, training) {
  return training.roles.includes("All Staff") || (!!staff.role && training.roles.includes(staff.role));
}
export function applies(staff, training) {
  return byRole(staff, training) || staff.extra.includes(training.id);
}

// Passed quiz, confirmed reading, or an older hand-entered record (no result, no score or score at the pass mark).
export function isPass(rec, training) {
  if (rec.result) return rec.result === "Passed" || rec.result === "Confirmed";
  if (rec.score == null) return true;
  return rec.score >= training.passMark;
}

// Status for one person and one training. today is "YYYY-MM-DD".
//   missing  -> nothing done yet
//   retake   -> latest quiz attempt below the pass mark
//   update   -> completed, but for an older version of the training
//   signoff  -> completed, waiting for the manager to sign off
//   late / soon / ok -> by due date
export function statusFor(staff, training, records, today) {
  if (!applies(staff, training)) return { status: "na" };
  const attempts = records
    .filter((r) => r.employeeId === staff.id && r.trainingId === training.id && r.completed)
    .sort((a, b) => a.completed.localeCompare(b.completed) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const last = attempts[attempts.length - 1] || null;
  const base = {
    attempts: attempts.length, last, extra: !byRole(staff, training),
    score: last?.score ?? null, done: last?.completed ?? null, signed: last?.signed ?? null,
  };
  if (!last) return { ...base, status: "missing" };
  if (!isPass(last, training)) return { ...base, status: "retake" };
  if (training.version && (last.version || "") !== training.version) return { ...base, status: "update" };
  if (training.needsSignoff && !last.signed) return { ...base, status: "signoff" };
  const now = parseDate(today);
  const due = training.frequency > 0 ? addMonths(parseDate(last.completed), training.frequency) : null;
  const days = due ? Math.round((due - now) / 86400000) : null;
  const status = due == null ? "ok" : days < 0 ? "late" : days <= DUE_SOON_DAYS ? "soon" : "ok";
  return { ...base, status, due: due ? isoDay(due) : null, days };
}

// ---------- lesson content: a training's Notion page, simplified for display ----------
function richText(arr) {
  return (arr || []).map((t) => {
    const a = t.annotations || {};
    const href = t.href && /^https:\/\//.test(t.href) ? t.href : null;
    return { text: t.plain_text, b: !!a.bold, i: !!a.italic, s: !!a.strikethrough, u: !!a.underline, code: !!a.code, color: a.color && a.color !== "default" ? a.color : null, href };
  });
}

async function children(blockId) {
  const out = [];
  let cursor;
  do {
    const data = await notion(`blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`, "GET");
    out.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

const NESTABLE = new Set(["callout", "column_list", "column", "toggle", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "synced_block"]);

export async function lessonBlocks(pageId, depth = 0, budget = { left: 400 }) {
  if (depth > 4 || budget.left <= 0) return [];
  const raw = await children(pageId);
  const out = [];
  for (const b of raw) {
    if (budget.left-- <= 0) break;
    const d = b[b.type] || {};
    const node = { type: b.type };
    if (d.rich_text) node.text = richText(d.rich_text);
    if (b.type === "to_do") node.checked = !!d.checked;
    if (b.type === "callout") {
      node.icon = d.icon?.type === "emoji" ? d.icon.emoji : null;
      node.color = d.color || "default";
    }
    if (b.type === "image") {
      node.src = d.type === "external" ? d.external?.url : d.file?.url;
      node.caption = richText(d.caption);
    }
    if (["bookmark", "embed", "video", "pdf", "file", "link_preview"].includes(b.type)) {
      node.href = d.url || d.external?.url || d.file?.url || null;
      node.caption = richText(d.caption);
    }
    if (b.has_children && NESTABLE.has(b.type)) node.children = await lessonBlocks(b.id, depth + 1, budget);
    out.push(node);
  }
  return out;
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
