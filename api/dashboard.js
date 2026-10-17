// Manager API.
//
//   GET  /api/dashboard?key=K   -> everyone's training status (K = a manager's personal link key)
//   POST /api/dashboard {key, recordId}   -> sign off one completion as that manager
//
// Access: a Team member with "Is Manager" or "Is Admin" ticked, using their own link key.
// Optional DASHBOARD_PASSWORD: also lets someone VIEW the dashboard with a password (no signing off).
// Link keys are never sent back.

import {
  PROPS, queryAll, getPage, updatePage, toStaff, toTraining, toRecord,
  statusFor, todayIn, findPerson, sendNotionError, onboardingEnabled,
} from "./_lib.js";

async function whoIsAsking(req) {
  const key = req.method === "POST" ? req.body?.key : req.query.key;
  if (key) {
    const person = await findPerson(key);
    if (person && (person.isManager || person.isAdmin)) return { manager: person };
    return { error: "not_manager" };
  }
  const pw = process.env.DASHBOARD_PASSWORD;
  if (pw && req.method === "GET" && req.headers["x-dashboard-password"] === pw) return { viewer: true };
  return { error: "login_required" };
}

function deny(res, error) {
  const message = error === "not_manager"
    ? "This link isn't a manager link. Ask an admin to tick “Is Manager” (or “Is Admin”) on your row in Notion, then use the Manager Link from there."
    : "This dashboard is for managers. Open your Manager Link from Notion.";
  return res.status(401).json({ error, message, passwordAllowed: !!process.env.DASHBOARD_PASSWORD });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const who = await whoIsAsking(req);
    if (who.error) return deny(res, who.error);
    const today = todayIn();

    // ---- sign off ----
    if (req.method === "POST") {
      const { recordId } = req.body || {};
      if (typeof recordId !== "string" || !/^[0-9a-f-]{32,36}$/i.test(recordId)) {
        return res.status(400).json({ error: "bad_request", message: "That record couldn't be found. Reload the page and try again." });
      }
      const page = await getPage(recordId);
      const rec = toRecord(page);
      const parentOk = (page.parent?.database_id || "").replace(/-/g, "") === String(process.env.COMPLETIONS_DB).replace(/-/g, "");
      if (!parentOk || page.archived || page.in_trash) return res.status(404).json({ error: "not_found", message: "That record couldn't be found. Reload the page and try again." });
      if (rec.signed) return res.status(409).json({ error: "already_signed", message: "This has already been signed off." });
      if (rec.employeeId === who.manager.id) return res.status(403).json({ error: "own_training", message: "You can't sign off your own training. Another manager needs to do it." });
      if (!(rec.result === "Passed" || rec.result === "Confirmed" || (!rec.result && rec.completed))) {
        return res.status(409).json({ error: "not_complete", message: "This attempt didn't pass, so there's nothing to sign off." });
      }
      const C = PROPS.completions;
      await updatePage(recordId, {
        [C.signed]: { date: { start: today } },
        [C.signedBy]: { relation: [{ id: who.manager.id }] },
      });
      return res.status(200).json({ signed: true, signedOn: today, signedBy: who.manager.name });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    // ---- everyone's status ----
    const [team, trainingRows, completions] = await Promise.all([
      queryAll(process.env.TEAM_DB),
      queryAll(process.env.TRAININGS_DB),
      queryAll(process.env.COMPLETIONS_DB),
    ]);
    const allStaff = team.map(toStaff);
    const nameById = new Map(allStaff.map((s) => [s.id, s.name]));
    const staff = allStaff.filter((s) => s.status !== "Former" && s.name !== "Unnamed");
    const trainings = trainingRows.map(toTraining);
    const records = completions.map(toRecord);

    const items = [];
    for (const s of staff) {
      for (const t of trainings) {
        const r = statusFor(s, t, records, today);
        if (r.status === "na") continue;
        items.push({
          staffId: s.id, trainingId: t.id, status: r.status,
          done: r.done, due: r.due || null, days: r.days ?? null,
          score: r.score, attempts: r.attempts, signed: r.signed, extra: r.extra,
          signedBy: r.last?.signedBy ? nameById.get(r.last.signedBy) || null : null,
          version: r.last?.version || null, recordUrl: r.last?.url || null, recordId: r.last?.id || null,
        });
      }
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      today,
      me: who.manager ? { id: who.manager.id, name: who.manager.name, isAdmin: who.manager.isAdmin } : null,
      canSignOff: !!who.manager,
      onboarding: onboardingEnabled() && !!who.manager,
      staff: staff.map(({ extra, excluded, onboardingManager, isAdmin, ...s }) => s),
      trainings: trainings.map(({ material, ...t }) => t),
      items,
    });
  } catch (e) {
    return sendNotionError(res, e);
  }
}
