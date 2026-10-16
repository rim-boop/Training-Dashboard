// GET /api/dashboard — manager view: every active person × every training that applies to them,
// with the status worked out by the same rules the employee page uses (api/_lib.js).
// Link keys are never included. Optional DASHBOARD_PASSWORD: if set, the page asks for it.

import { queryAll, toStaff, toTraining, toRecord, statusFor, todayIn, sendNotionError } from "./_lib.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const pw = process.env.DASHBOARD_PASSWORD;
  if (pw && req.headers["x-dashboard-password"] !== pw) {
    return res.status(401).json({ error: "password_required" });
  }
  try {
    const [team, trainingRows, completions] = await Promise.all([
      queryAll(process.env.TEAM_DB),
      queryAll(process.env.TRAININGS_DB),
      queryAll(process.env.COMPLETIONS_DB),
    ]);
    const today = todayIn();
    const staff = team.map(toStaff).filter((s) => s.status !== "Former" && s.name !== "Unnamed");
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
          version: r.last?.version || null, recordUrl: r.last?.url || null,
        });
      }
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      today,
      staff: staff.map(({ extra, ...s }) => s),
      trainings: trainings.map(({ material, ...t }) => t),
      items,
    });
  } catch (e) {
    return sendNotionError(res, e);
  }
}
