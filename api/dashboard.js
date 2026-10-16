// GET /api/dashboard — admin view data: everyone's trainings and attempts.
// Access keys are never included, so the admin page can't leak personal links.
// Optional DASHBOARD_PASSWORD environment variable: if set, the page asks for it.

import { queryAll, toStaff, toTraining, toRecord, sendNotionError, todayIn } from "./_lib.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
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
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      today: todayIn(),
      staff: team.map(toStaff),
      trainings: trainings.map(toTraining),
      records: completions.map(toRecord),
    });
  } catch (e) {
    return sendNotionError(res, e);
  }
}
