// Onboarding API.
//
//   GET  /api/onboarding?key=K                -> my own onboarding checklist (New hire tasks)
//   GET  /api/onboarding?key=K&view=team      -> everyone being onboarded (managers and admins)
//   POST /api/onboarding {key, action:"start", personId}            -> create that person's tasks from the Task Library
//   POST /api/onboarding {key, action:"done" | "undo", taskId}       -> tick or untick one task
//
// Who can do what:
//   - Everyone ticks their own "New hire" tasks.
//   - A person's appointed Onboarding Manager, or anyone with "Is Admin", starts their onboarding
//     and ticks any of their tasks, including "HR & Compliance" ones.
//   - Any manager or admin can see the team view.

import {
  PROPS, FOR_HR, FOR_NEW_HIRE, queryAll, createPage, getPage, updatePage, toStaff,
  toLibraryTask, toOnboardTask, libraryApplies, addDays, taskState, sortTasks,
  canManageOnboarding, onboardingEnabled, findPerson, todayIn, sendNotionError,
} from "./_lib.js";

const O = PROPS.onboardTasks;
const ID_RE = /^[0-9a-f-]{32,36}$/i;
const CREATE_PER_CALL = 12; // keeps each request well inside the hosting time limit; the page calls again for the rest
const sameId = (a, b) => String(a || "").replace(/-/g, "") === String(b || "").replace(/-/g, "");

function publicTask(t, today, nameById) {
  return {
    id: t.id, name: t.name, for: t.for, phase: t.phase, owner: t.owner, category: t.category,
    due: t.due, doneOn: t.doneOn, doneBy: t.doneBy ? nameById?.get(t.doneBy) || null : null,
    notes: t.notes, link: t.link, state: taskState(t, today),
  };
}

function counts(list, today) {
  const c = { total: list.length, done: 0, late: 0 };
  for (const t of list) { const s = taskState(t, today); if (s === "done") c.done++; if (s === "late") c.late++; }
  return c;
}

async function loadMember(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  const page = await getPage(id);
  if (!sameId(page.parent?.database_id, process.env.TEAM_DB) || page.archived || page.in_trash) return null;
  return toStaff(page);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!onboardingEnabled()) return res.status(200).json({ enabled: false });
  const today = todayIn();

  try {
    const key = req.method === "POST" ? req.body?.key : req.query.key;
    const actor = await findPerson(key);
    if (!actor) return res.status(403).json({ error: "bad_key", message: "This link isn't valid. Ask your manager for your personal link." });

    // ---------- changes ----------
    if (req.method === "POST") {
      const { action, personId, taskId } = req.body || {};

      if (action === "start") {
        const member = await loadMember(personId);
        if (!member || member.status === "Former") return res.status(404).json({ error: "not_found", message: "That person couldn't be found. Reload the page and try again." });
        if (!canManageOnboarding(actor, member)) return res.status(403).json({ error: "not_allowed", message: "Only their onboarding manager or an admin can start this onboarding." });
        if (!member.hireDate) return res.status(409).json({ error: "no_hire_date", message: `Add a Hire Date for ${member.name} in Notion first. Due dates are worked out from it.` });

        const [libraryRows, existingRows] = await Promise.all([
          queryAll(process.env.ONBOARD_LIBRARY_DB),
          queryAll(process.env.ONBOARD_TASKS_DB, { property: O.member, relation: { contains: member.id } }),
        ]);
        const have = new Set(existingRows.map(toOnboardTask).map((t) => t.libraryId).filter(Boolean).map((x) => x.replace(/-/g, "")));
        const todo = libraryRows.map(toLibraryTask)
          .filter((l) => libraryApplies(member, l) && !have.has(l.id.replace(/-/g, "")));
        const batch = todo.slice(0, CREATE_PER_CALL);
        for (const l of batch) {
          await createPage(process.env.ONBOARD_TASKS_DB, {
            [O.task]: { title: [{ text: { content: l.name.slice(0, 1900) } }] },
            [O.member]: { relation: [{ id: member.id }] },
            [O.library]: { relation: [{ id: l.id }] },
            [O.for]: { select: { name: l.for } },
            ...(l.phase ? { [O.phase]: { select: { name: l.phase } } } : {}),
            ...(l.owner ? { [O.owner]: { select: { name: l.owner } } } : {}),
            ...(l.category ? { [O.category]: { select: { name: l.category } } } : {}),
            ...(typeof l.days === "number" ? { [O.due]: { date: { start: addDays(member.hireDate, Math.round(l.days)) } } } : {}),
            ...(l.link ? { [O.link]: { url: l.link } } : {}),
            ...(l.notes ? { [O.notes]: { rich_text: [{ text: { content: l.notes.slice(0, 1900) } }] } } : {}),
            ...(typeof l.order === "number" ? { [O.order]: { number: l.order } } : {}),
          });
        }
        return res.status(200).json({ created: batch.length, remaining: todo.length - batch.length, total: existingRows.length + batch.length });
      }

      if (action === "done" || action === "undo") {
        if (typeof taskId !== "string" || !ID_RE.test(taskId)) return res.status(400).json({ error: "bad_request", message: "That task couldn't be found. Reload the page and try again." });
        const page = await getPage(taskId);
        if (!sameId(page.parent?.database_id, process.env.ONBOARD_TASKS_DB) || page.archived || page.in_trash) {
          return res.status(404).json({ error: "not_found", message: "That task couldn't be found. Reload the page and try again." });
        }
        const task = toOnboardTask(page);
        const own = sameId(task.memberId, actor.id);
        let allowed = own && task.for === FOR_NEW_HIRE;
        if (!allowed && task.memberId) allowed = canManageOnboarding(actor, await loadMember(task.memberId));
        if (!allowed) {
          return res.status(403).json({ error: "not_allowed", message: own
            ? "This one is ticked off by your onboarding manager or HR."
            : "Only this person's onboarding manager or an admin can tick this off." });
        }
        if (action === "done" && task.doneOn) return res.status(200).json({ done: true, doneOn: task.doneOn, already: true });
        await updatePage(taskId, action === "done"
          ? { [O.doneOn]: { date: { start: today } }, [O.doneBy]: { relation: [{ id: actor.id }] } }
          : { [O.doneOn]: { date: null }, [O.doneBy]: { relation: [] } });
        return res.status(200).json({ done: action === "done", doneOn: action === "done" ? today : null, doneBy: action === "done" ? actor.name : null });
      }

      return res.status(400).json({ error: "bad_request", message: "Something was missing. Reload the page and try again." });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    // ---------- team view ----------
    if (req.query.view === "team") {
      if (!actor.isManager && !actor.isAdmin) return res.status(403).json({ error: "not_manager", message: "The onboarding overview is for managers and admins." });
      const [teamRows, taskRows] = await Promise.all([queryAll(process.env.TEAM_DB), queryAll(process.env.ONBOARD_TASKS_DB)]);
      const team = teamRows.map(toStaff);
      const nameById = new Map(team.map((s) => [s.id, s.name]));
      const tasks = taskRows.map(toOnboardTask);
      const byMember = new Map();
      for (const t of tasks) { if (!t.memberId) continue; if (!byMember.has(t.memberId)) byMember.set(t.memberId, []); byMember.get(t.memberId).push(t); }

      const people = team
        .filter((s) => s.status !== "Former" && s.name !== "Unnamed" && (s.status === "Onboarding" || byMember.has(s.id)))
        .map((s) => {
          const mine = sortTasks(byMember.get(s.id) || []);
          const hr = mine.filter((t) => t.for === FOR_HR), nh = mine.filter((t) => t.for !== FOR_HR);
          return {
            id: s.id, name: s.name, role: s.role, status: s.status, hireDate: s.hireDate,
            manager: s.onboardingManager ? nameById.get(s.onboardingManager) || null : null,
            canManage: canManageOnboarding(actor, s),
            started: mine.length > 0,
            all: counts(mine, today), hr: counts(hr, today), newHire: counts(nh, today),
            tasks: mine.map((t) => publicTask(t, today, nameById)),
          };
        })
        .sort((a, b) => String(a.hireDate || "9999").localeCompare(String(b.hireDate || "9999")) || a.name.localeCompare(b.name));

      return res.status(200).json({
        enabled: true, today, me: { id: actor.id, name: actor.name, isAdmin: actor.isAdmin }, people,
      });
    }

    // ---------- my checklist ----------
    const rows = await queryAll(process.env.ONBOARD_TASKS_DB, { property: O.member, relation: { contains: actor.id } });
    const mine = sortTasks(rows.map(toOnboardTask));
    const nh = mine.filter((t) => t.for !== FOR_HR), hr = mine.filter((t) => t.for === FOR_HR);
    return res.status(200).json({
      enabled: true, today, hireDate: actor.hireDate, status: actor.status,
      tasks: nh.map((t) => publicTask(t, today)),
      mine: counts(nh, today), hr: counts(hr, today),
    });
  } catch (e) {
    return sendNotionError(res, e);
  }
}
