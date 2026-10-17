// Employee API. Everything is scoped to the person whose link key is sent; nobody else's data is returned.
//
//   GET  /api/me?key=K                       -> my trainings with status
//   GET  /api/me?key=K&lesson=TRAINING_ID    -> the training's lesson (its Notion page) + what's needed to complete it
//   GET  /api/me?key=K&quiz=TRAINING_ID      -> quiz questions (never the answers)
//   POST /api/me {key, trainingId, action:"quiz", answers:{questionId:"A".."D"}}   -> mark and save
//   POST /api/me {key, trainingId, action:"confirm"}                              -> save "read and understood"

import {
  PROPS, queryAll, createPage, val, toTraining, toRecord,
  applies, statusFor, todayIn, lessonBlocks, findPerson, sendNotionError,
} from "./_lib.js";

async function myTraining(person, trainingId) {
  const rows = await queryAll(process.env.TRAININGS_DB);
  const t = rows.map(toTraining).find((x) => x.id === trainingId);
  return t && applies(person, t) ? t : null;
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
    completion: t.completion, needsSignoff: t.needsSignoff, version: t.version, onboarding: !!t.onboarding,
    status: s.status, due: s.due || null, days: s.days ?? null, done: s.done || null,
    attempts: s.attempts || 0, lastScore: s.score ?? null, extra: !!s.extra,
    questionCount,
  };
}

function dayLabel(today) {
  return new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const today = todayIn();
  const C = PROPS.completions;

  try {
    if (req.method === "POST") {
      const { key, trainingId, action, answers } = req.body || {};
      const person = await findPerson(key);
      if (!person) return res.status(403).json({ error: "bad_key", message: "This link isn't valid any more. Ask your manager for a new one." });
      if (typeof trainingId !== "string") return res.status(400).json({ error: "bad_request", message: "Something was missing. Reload the page and try again." });
      const training = await myTraining(person, trainingId);
      if (!training) return res.status(403).json({ error: "not_assigned", message: "This training isn't assigned to you." });

      const common = {
        [C.employee]: { relation: [{ id: person.id }] },
        [C.training]: { relation: [{ id: training.id }] },
        [C.completed]: { date: { start: today } },
        ...(training.version ? { [C.version]: { rich_text: [{ text: { content: training.version } }] } } : {}),
      };

      // ---- read and confirm ----
      if (action === "confirm") {
        if (training.completion !== "Read & confirm") return res.status(409).json({ error: "needs_quiz", message: "This training is completed by passing its quiz." });
        await createPage(process.env.COMPLETIONS_DB, {
          [C.title]: { title: [{ text: { content: `${person.name} – ${training.name} (confirmed ${dayLabel(today)})` } }] },
          ...common,
          [C.result]: { select: { name: "Confirmed" } },
          [C.source]: { select: { name: "Confirmed in app" } },
          [C.answers]: { rich_text: [{ text: { content: "I have read and understood this training." } }] },
        });
        return res.status(200).json({ confirmed: true, needsSignoff: training.needsSignoff });
      }

      // ---- quiz ----
      if (training.completion !== "Quiz") return res.status(409).json({ error: "no_quiz", message: "This training is completed by confirming you've read it." });
      if (!answers || typeof answers !== "object") return res.status(400).json({ error: "bad_request", message: "Your answers were missing. Reload the page and try again." });
      const questions = await loadQuestions(trainingId);
      if (!questions.length) return res.status(409).json({ error: "no_quiz", message: "This training has no quiz questions yet." });
      const missing = questions.filter((q) => !["A", "B", "C", "D"].includes(answers[q.id]));
      if (missing.length) return res.status(400).json({ error: "incomplete", message: `Answer all ${questions.length} questions before submitting.` });

      const review = questions.map((q, i) => ({ number: i + 1, chosen: answers[q.id], right: answers[q.id] === q.correct }));
      const correct = review.filter((r) => r.right).length;
      const score = Math.round((correct / questions.length) * 100);
      const passed = score >= training.passMark;
      await createPage(process.env.COMPLETIONS_DB, {
        [C.title]: { title: [{ text: { content: `${person.name} – ${training.name} (quiz ${dayLabel(today)})` } }] },
        ...common,
        [C.score]: { number: score },
        [C.result]: { select: { name: passed ? "Passed" : "Retake required" } },
        [C.source]: { select: { name: "Quiz in app" } },
        [C.answers]: { rich_text: [{ text: { content: review.map((r) => `Q${r.number}: ${r.chosen} ${r.right ? "✓" : "✗"}`).join(" · ").slice(0, 1900) } }] },
      });
      return res.status(200).json({
        score, passed, passMark: training.passMark, correct, total: questions.length,
        needsSignoff: training.needsSignoff, review: review.map((r) => ({ number: r.number, right: r.right })),
      });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    const person = await findPerson(req.query.key);
    if (!person) return res.status(403).json({ error: "bad_key", message: "This link isn't valid. Ask your manager for your personal link." });

    // ---- one training's lesson ----
    if (req.query.lesson) {
      const training = await myTraining(person, req.query.lesson);
      if (!training) return res.status(403).json({ error: "not_assigned", message: "This training isn't assigned to you." });
      const [blocks, recordRows, questions] = await Promise.all([
        lessonBlocks(training.id),
        queryAll(process.env.COMPLETIONS_DB, { property: C.employee, relation: { contains: person.id } }),
        training.completion === "Quiz" ? loadQuestions(training.id) : Promise.resolve([]),
      ]);
      const s = statusFor(person, training, recordRows.map(toRecord), today);
      return res.status(200).json({ training: publicTraining(training, s, questions.length), blocks });
    }

    // ---- quiz questions ----
    if (req.query.quiz) {
      const training = await myTraining(person, req.query.quiz);
      if (!training) return res.status(403).json({ error: "not_assigned", message: "This training isn't assigned to you." });
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
      queryAll(process.env.COMPLETIONS_DB, { property: C.employee, relation: { contains: person.id } }),
      queryAll(process.env.QUESTIONS_DB),
    ]);
    const records = recordRows.map(toRecord);
    const qCount = {};
    for (const p of questionRows) for (const tid of val(p, PROPS.questions.training) || []) qCount[tid] = (qCount[tid] || 0) + 1;
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      today,
      person: { name: person.name, role: person.role, isManager: person.isManager || person.isAdmin, status: person.status },
      trainings: trainingRows.map(toTraining).filter((t) => applies(person, t))
        .map((t) => publicTraining(t, statusFor(person, t, records, today), qCount[t.id] || 0))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return sendNotionError(res, e);
  }
}
