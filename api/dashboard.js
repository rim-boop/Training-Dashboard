// GET /api/dashboard
// Reads the three Notion databases and returns them as plain JSON.
// All compliance logic (due dates, statuses) runs in the page, so this stays a thin reader.
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   NOTION_TOKEN          Notion integration secret (stays on the server)
//   TEAM_DB               Team database ID
//   TRAININGS_DB          Trainings database ID
//   COMPLETIONS_DB        Completions database ID
//   DASHBOARD_PASSWORD    optional: if set, the page asks for this password

// Property names in Notion. Change these to point the app at different databases (e.g. STOKE).
const PROPS = {
  team: { name: "Name", role: "Role", status: "Employment Status", hireDate: "Hire Date" },
  trainings: { name: "Item", roles: "Relevant Role", frequency: "Frequency (months)", category: "Category" },
  completions: { employee: "Employee", training: "Training", completed: "Completed On", signed: "Manager Signed On" },
};

const NOTION_VERSION = "2022-06-28";

async function queryAll(databaseId) {
  const rows = [];
  let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
    });
    if (!r.ok) {
      const err = new Error(`Notion returned ${r.status} for database ${databaseId}`);
      err.status = r.status;
      err.detail = await r.text();
      throw err;
    }
    const data = await r.json();
    rows.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return rows;
}

// Read any Notion property as a simple value.
function val(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case "title":
    case "rich_text":
      return p[p.type].map((t) => t.plain_text).join("").trim() || null;
    case "select":
      return p.select?.name ?? null;
    case "status":
      return p.status?.name ?? null;
    case "multi_select":
      return p.multi_select.map((o) => o.name);
    case "number":
      return p.number;
    case "date":
      return p.date?.start ? p.date.start.slice(0, 10) : null;
    case "relation":
      return p.relation.map((r) => r.id);
    case "people":
      return p.people.map((u) => u.name || u.id);
    case "checkbox":
      return p.checkbox;
    case "formula": {
      const f = p.formula;
      return f[f.type]?.start ?? f[f.type] ?? null;
    }
    case "rollup": {
      const r = p.rollup;
      if (r.type === "date") return r.date?.start ?? null;
      if (r.type === "number") return r.number;
      return null;
    }
    default:
      return null;
  }
}

export default async function handler(req, res) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (pw && req.headers["x-dashboard-password"] !== pw) {
    return res.status(401).json({ error: "password_required" });
  }

  try {
    const [team, trainings, completions] = await Promise.all([
      queryAll(process.env.TEAM_DB),
      queryAll(process.env.TRAININGS_DB),
      queryAll(process.env.COMPLETIONS_DB),
    ]);

    const T = PROPS.team, R = PROPS.trainings, C = PROPS.completions;

    const body = {
      generatedAt: new Date().toISOString(),
      staff: team.map((p) => ({
        id: p.id,
        name: val(p, T.name) || "Unnamed",
        role: val(p, T.role),
        status: val(p, T.status),
        hireDate: val(p, T.hireDate),
        url: p.url,
      })),
      trainings: trainings.map((p) => ({
        id: p.id,
        name: val(p, R.name) || "Untitled training",
        roles: val(p, R.roles) || [],
        frequency: val(p, R.frequency) ?? 0,
        category: val(p, R.category),
        url: p.url,
      })),
      records: completions.map((p) => ({
        id: p.id,
        employeeId: (val(p, C.employee) || [])[0] || null,
        trainingId: (val(p, C.training) || [])[0] || null,
        completed: val(p, C.completed),
        signed: val(p, C.signed),
        url: p.url,
      })),
    };

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(body);
  } catch (e) {
    const status = e.status === 401 || e.status === 403 || e.status === 404 ? 502 : 500;
    return res.status(status).json({
      error: "notion_error",
      message:
        e.status === 404
          ? "Notion couldn't find one of the databases. Check the IDs and that the integration is connected to each database."
          : e.status === 401
          ? "Notion rejected the integration secret. Check NOTION_TOKEN."
          : "Notion couldn't be reached. Try again in a minute.",
    });
  }
}
