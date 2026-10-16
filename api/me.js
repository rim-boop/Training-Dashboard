// Employee API. Everything is scoped to the person whose Access Key is sent; nobody else's data is returned.
//
//   GET  /api/me?key=K                    -> my trainings with status, score and attempts
//   GET  /api/me?key=K&quiz=TRAINING_ID   -> quiz questions for one of my trainings (no answers)
//   POST /api/me  {key, trainingId, answers: {questionId: "A".."D"}}  -> mark it and save the attempt to Notion

import {
  PROPS, queryAll, createPage, val, toStaff, toTraining, toRecord,
  applies, statusFor, todayIn, sendNotionError,
} from "./_lib.js";

const KEY_RE = /^[a-z0-9]{8,64}$/i;

async function findPerson(key) {
  if (!KEY_RE.test(key || "")) return null;
  const rows = await queryAll(process.env.TEAM_DB, { property: PROPS.team.key, rich_text: { equals: key } });
  const people = rows.map(toStaff).filter((s) => s.status !== "Former");
  return people.length === 1 ? people[0] : null; // a duplicated key opens nothing
}

async function loadQuestions(trainingId) {
  const Q = PROPS.questions;
  const rows = await queryAll(process.env.QUESTIONS_DB, { property: Q.training, relation: { contains: trainingId } });
  return rows
    .map((p) => ({
      id: p.id,
      order: val(p, Q.order) ?? 999,
      text: val(p, Q.question) || "",
      options: { A: val(p, Q.a), B: val(p, Q.b), C: val(p, Q.c), D: val(p, Q.d) },
      correct: val(p, Q.correct),
    }))
    .filter((q) => q.text && q.correct && q.options[q.correct])
    .sort((a, b) => a.order - b.order);
}

function publicTraining(t, s, questionCount) {
  return {
    id: t.id, name: t.name, category: t.category, frequency: t.frequency, passMark: t.passMark, material: t.material,
    status: s.status, due: s.due || null, days: s.days ?? null, done: s.done || null,
    attempts: s.attempts || 0,
    lastScore: s.last?.score ?? null,
    lastDate: s.last?.completed ?? null,
    needsSignoff: !!s.needsSignoff,
    questionCount,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const today = todayIn();

  try {
    // ---- submit a quiz ----
    if (req.method === "POST") {
      const { key, trainingId, answers } = req.body || {};
      const person = await findPerson(key);
      if (!person) return res.status(403).json({ error: "bad_key", message: "This link isn't valid any more. Ask your manager for a new one." });
      if (typeof trainingId !== "string" || !answers || typeof answers !== "object") {
        return res.status(400).json({ error: "bad_request", message: "Something was missing from the answers. Reload the page and try again." });
      }

      const trainingRows = await queryAll(process.env.TRAININGS_DB);
      const training = trainingRows.map(toTraining).find((t) => t.id === trainingId);
      if (!training || !applies(person, training)) {
        return res.status(403).json({ error: "not_assigned", message: "This training isn't assigned to you." });
      }
      const questions = await loadQuestions(trainingId);
      if (!questions.length) return res.status(409).json({ error: "no_quiz", message: "This training has no quiz questions yet." });

      const missing = questions.filter((q) => !["A", "B", "C", "D"].includes(answers[q.id]));
      if (missing.length) return res.status(400).json({ error: "incomplete", message: `Answer all ${questions.length} questions before submitting.` });

      const review = questions.map((q, i) => ({ id: q.id, number: i + 1, chosen: answers[q.id], right: answers[q.id] === q.correct }));
      const correct = review.filter((r) => r.right).length;
      const score = Math.round((correct / questions.length) * 100);
      const passed = score >= training.passMark;

      const C = PROPS.completions;
      const day = new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      const summary = review.map((r) => `Q${r.number}: ${r.chosen} ${r.right ? "✓" : "✗"}`).join(" · ");
      await createPage(process.env.COMPLETIONS_DB, {
        [C.title]: { title: [{ text: { content: `${person.name} – ${training.name} (quiz ${day})` } }] },
        [C.employee]: { relation: [{ id: person.id }] },
        [C.training]: { relation: [{ id: training.id }] },
        [C.completed]: { date: { start: today } },
        [C.score]: { number: score },
        [C.result]: { select: { name: passed ? "Passed" : "Retake required" } },
        [C.source]: { select: { name: "Quiz in app" } },
        [C.answers]: { rich_text: [{ text: { content: summary.slice(0, 1900) } }] },
      });

      return res.status(200).json({
        score, passed, passMark: training.passMark, correct, total: questions.length,
        review: review.map((r) => ({ number: r.number, right: r.right })),
      });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    const key = req.query.key;
    const person = await findPerson(key);
    if (!person) return res.status(403).json({ error: "bad_key", message: "This link isn't valid. Ask your manager for your personal link." });

    // ---- quiz questions for one training ----
    if (req.query.quiz) {
      const trainingRows = await queryAll(process.env.TRAININGS_DB);
      const training = trainingRows.map(toTraining).find((t) => t.id === req.query.quiz);
      if (!training || !applies(person, training)) {
        return res.status(403).json({ error: "not_assigned", message: "This training isn't assigned to you." });
      }
      const questions = await loadQuestions(training.id);
      return res.status(200).json({
        training: { id: training.id, name: training.name, passMark: training.passMark, material: training.material },
        questions: questions.map((q) => ({
          id: q.id, text: q.text,
          options: Object.entries(q.options).filter(([, v]) => v).map(([letter, text]) => ({ letter, text })),
        })),
      });
    }

    // ---- my trainings ----
    const [trainingRows, recordRows, questionRows] = await Promise.all([
      queryAll(process.env.TRAININGS_DB),
      queryAll(process.env.COMPLETIONS_DB, { property: PROPS.completions.employee, relation: { contains: person.id } }),
      queryAll(process.env.QUESTIONS_DB),
    ]);
    const trainings = trainingRows.map(toTraining).filter((t) => applies(person, t));
    const records = recordRows.map(toRecord);
    const qCount = {};
    for (const p of questionRows) for (const tid of val(p, PROPS.questions.training) || []) qCount[tid] = (qCount[tid] || 0) + 1;

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      today,
      person: { name: person.name, role: person.role },
      trainings: trainings
        .map((t) => publicTraining(t, statusFor(person, t, records, today), qCount[t.id] || 0))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return sendNotionError(res, e);
  }
}
