// Notion training portal API (for managers and admins).
//
//   GET  /api/notion-training?key=K               -> modules and videos, with what I've watched
//   GET  /api/notion-training?key=K&video=ID      -> one video with its written steps (the video page's content)
//   POST /api/notion-training {key, videoId, action:"watched" | "unwatch"}
//
// Environment: NOTION_TRAINING_DB (the Training Library database), NOTION_TRAINING_DONE_DB (Notion Training Completions).
// Which videos show: Status "Published", or "Recorded" / "In progress" when a video link is filled in.

import { queryAll, createPage, getPage, val, findPerson, todayIn, lessonBlocks, sendNotionError } from "./_lib.js";

const L = { title: "Video", module: "Module", order: "Order", minutes: "Minutes", link: "Loom", status: "Status", audience: "Audience", covers: "What it covers" };
const D = { title: "Record", member: "Team Member", video: "Video", watched: "Watched On" };
const ID_RE = /^[0-9a-f-]{32,36}$/i;
const sameId = (a, b) => String(a || "").replace(/-/g, "") === String(b || "").replace(/-/g, "");
const enabled = () => !!(process.env.NOTION_TRAINING_DB && process.env.NOTION_TRAINING_DONE_DB);

async function notionPatch(pageId, body) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const e = new Error("Notion returned " + r.status); e.status = r.status; throw e; }
  return r.json();
}

function toVideo(p) {
  const link = val(p, L.link);
  return {
    id: p.id, name: val(p, L.title) || "Untitled video", module: val(p, L.module) || "Other",
    order: val(p, L.order) ?? 999, minutes: val(p, L.minutes), status: val(p, L.status), audience: val(p, L.audience),
    covers: val(p, L.covers), link: typeof link === "string" && /^https:\/\//.test(link) ? link : null,
  };
}
function visible(v) {
  if (v.status === "Published") return true;
  return (v.status === "Recorded" || v.status === "In progress") && !!v.link;
}
function publicVideo(v, watchedOn) {
  return { id: v.id, name: v.name, module: v.module, minutes: v.minutes, covers: v.covers, link: v.link, audience: v.audience, watched: !!watchedOn, watchedOn: watchedOn || null };
}
async function myWatched(personId) {
  const rows = await queryAll(process.env.NOTION_TRAINING_DONE_DB, { property: D.member, relation: { contains: personId } });
  const map = new Map();
  for (const r of rows) for (const vid of val(r, D.video) || []) map.set(vid.replace(/-/g, ""), { rowId: r.id, on: val(r, D.watched) });
  return { rows, map };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!enabled()) return res.status(200).json({ enabled: false });
  try {
    const key = req.method === "POST" ? req.body?.key : req.query.key;
    const person = await findPerson(key);
    if (!person) return res.status(403).json({ error: "bad_key", message: "This link isn't valid. Open your Manager Link from Notion." });
    if (!person.isManager && !person.isAdmin) return res.status(403).json({ error: "not_manager", message: "The Notion training is for managers and admins." });

    // ---------- mark watched / not watched ----------
    if (req.method === "POST") {
      const { videoId, action } = req.body || {};
      if (typeof videoId !== "string" || !ID_RE.test(videoId) || !["watched", "unwatch"].includes(action)) {
        return res.status(400).json({ error: "bad_request", message: "Something was missing. Reload the page and try again." });
      }
      const page = await getPage(videoId);
      if (!sameId(page.parent?.database_id, process.env.NOTION_TRAINING_DB) || page.archived || page.in_trash) {
        return res.status(404).json({ error: "not_found", message: "That video couldn't be found. Reload the page and try again." });
      }
      const video = toVideo(page);
      const { rows } = await myWatched(person.id);
      const mine = rows.filter((r) => (val(r, D.video) || []).some((v) => sameId(v, video.id)));
      if (action === "watched") {
        if (mine.length) return res.status(200).json({ watched: true, already: true });
        const today = todayIn();
        await createPage(process.env.NOTION_TRAINING_DONE_DB, {
          [D.title]: { title: [{ text: { content: `${person.name} – ${video.name}`.slice(0, 1900) } }] },
          [D.member]: { relation: [{ id: person.id }] },
          [D.video]: { relation: [{ id: video.id }] },
          [D.watched]: { date: { start: today } },
        });
        return res.status(200).json({ watched: true, watchedOn: today });
      }
      for (const r of mine) await notionPatch(r.id, { archived: true });
      return res.status(200).json({ watched: false });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    // ---------- one video ----------
    if (req.query.video) {
      const id = req.query.video;
      if (typeof id !== "string" || !ID_RE.test(id)) return res.status(400).json({ error: "bad_request", message: "That video couldn't be found." });
      const page = await getPage(id);
      if (!sameId(page.parent?.database_id, process.env.NOTION_TRAINING_DB) || page.archived || page.in_trash) {
        return res.status(404).json({ error: "not_found", message: "That video couldn't be found." });
      }
      const video = toVideo(page);
      if (!visible(video)) return res.status(404).json({ error: "not_published", message: "This video isn't published yet." });
      const [{ map }, blocks] = await Promise.all([myWatched(person.id), lessonBlocks(video.id)]);
      return res.status(200).json({ video: publicVideo(video, map.get(video.id.replace(/-/g, ""))?.on), blocks });
    }

    // ---------- library ----------
    const [rows, { map }] = await Promise.all([queryAll(process.env.NOTION_TRAINING_DB), myWatched(person.id)]);
    const videos = rows.map(toVideo).filter(visible)
      .sort((a, b) => a.module.localeCompare(b.module) || a.order - b.order || a.name.localeCompare(b.name));
    const modules = [];
    for (const v of videos) {
      let m = modules.find((x) => x.name === v.module);
      if (!m) { m = { name: v.module, videos: [], total: 0, watched: 0, minutes: 0 }; modules.push(m); }
      const pv = publicVideo(v, map.get(v.id.replace(/-/g, ""))?.on);
      m.videos.push(pv); m.total++; if (pv.watched) m.watched++; m.minutes += Number(v.minutes) || 0;
    }
    return res.status(200).json({
      enabled: true, person: { name: person.name },
      total: videos.length, watched: modules.reduce((n, m) => n + m.watched, 0), modules,
    });
  } catch (e) {
    return sendNotionError(res, e);
  }
}
