# Training Compliance Dashboard

A training app on top of Notion. Managers see everyone's compliance; each employee gets a private page with their own trainings and quizzes. All data lives in Notion.

## Pages

| Page | Who | What |
|---|---|---|
| `/` (index.html) | Managers | Overview heatmap, By Employee, By Training, Calendar, retakes and sign-offs |
| `/me.html?key=…` (me.html) | One employee | Their trainings, due dates, scores, and the quiz for each training |

## Files

```
index.html        manager dashboard
me.html           employee page
package.json
api/_lib.js       shared Notion + compliance logic (not a public route)
api/dashboard.js  data for the manager dashboard (never includes access keys)
api/me.js         one employee's data, quiz questions (without answers), quiz marking
```

## Notion databases

- **Team**: Name, Role, Employment Status, Hire Date, **Extra Trainings** (assigned on top of their role), **Personal Link** (made automatically), **Access Key** (leave empty; type a new key only to cut off a link that leaked), **Link Key** (formula, don't edit).
- **Trainings**: Item, Relevant Role, Frequency (months; 0 = one-time), Category, **Completion** (Read & confirm / Quiz), **Manager Sign-off** (tick if a manager must sign off), **Version** (change it when the SOP is updated), **Pass Mark (%)** (quiz only; empty = 80), **Material Link** (optional extra document). **The lesson itself is the training's page content in Notion**: edit it like any Notion page and the app shows the new version straight away.
- **Quiz Questions**: Question, Training, Option A–D, Correct Answer (A–D), Order.
- **Completions**: Employee, Training, Completed On, Manager Signed On, **Score (%)**, **Result** (Passed / Retake required), **Source**, **Answers**.

## How statuses work

For every active person × every training that applies to them (by role, "All Staff", or Extra Trainings):

| Status | Rule |
|---|---|
| Not completed | No attempt yet |
| Retake required | The latest quiz attempt scored below the training's pass mark |
| New version | Completed, but for an older Version than the training's current one |
| Awaiting sign-off | Completed by the employee; the training needs Manager Sign-off and Manager Signed On is empty |
| Overdue | Last pass + Frequency is in the past |
| Due soon | Due within 60 days |
| Compliant | Passed, and not due for at least 60 days (or one-time) |

Every quiz attempt is saved as a new Completions row, so the full history stays in Notion. Rows entered by hand with no score count as passed.

## Environment variables (Vercel → Settings → Environments → Production)

| Key | Value |
|---|---|
| `NOTION_TOKEN` | Notion integration secret. The integration needs **Read content** and **Insert content**. |
| `TEAM_DB` | `d851f02168764a019956e8c7eb38a87a` |
| `TRAININGS_DB` | `c8a738470c2b4e4db59259932a920e69` |
| `COMPLETIONS_DB` | `c2aab986e44b48149b32ff7b7f677769` |
| `QUESTIONS_DB` | `38e45a046652440eb03ad96af4bf3209` |
| `DASHBOARD_PASSWORD` | Optional but recommended: protects the manager dashboard |
| `TIMEZONE` | Optional, default `Asia/Dubai` |

## Day-to-day

- **New hire:** add them to Team with a Role. Copy their **Personal Link** from Notion and send it to them.
- **One-off assignment:** add the training to the person's Extra Trainings.
- **New quiz:** add rows to Quiz Questions linked to the training, and set its Pass Mark.
- **Lost or shared link:** type a new Access Key for that person. The old link stops working immediately.
- **SOP updated:** edit the training page, then change its Version. Everyone who confirmed the old version is asked to confirm again.
- **Manager sign-off:** fill in Manager Signed On on the passing Completions row.

## Onboarding (optional part)

Turned on when these two Vercel variables are set: `ONBOARD_LIBRARY_DB`, `ONBOARD_TASKS_DB`.

- **Onboarding Task Library**: the master checklist. Columns: Task, For (New hire / HR & Compliance), Phase, Relevant Role, Days From Start, Owner, Category, Link, Notes, Order, Retired.
- **Onboarding Tasks**: one row per person per task, created by the app. Due Date = Hire Date + Days From Start.
- **Team**: `Onboarding Manager` (who runs this person's onboarding) and `Is Admin` (can manage anyone's onboarding and open the dashboard).

Flow: set Employment Status = Onboarding + Hire Date + Onboarding Manager → dashboard › Onboarding › Start onboarding → the new hire ticks their tasks on their personal link; the onboarding manager or an admin ticks HR & Compliance tasks on the dashboard. Trainings ticked "Required at Onboarding" also show on the new hire's checklist.

## Notion training (optional part, managers and admins)

`/notion.html?key=<Link Key>` — the Notion Setup Training Library as a portal: Loom videos, written steps, and "Mark as watched".
Turned on with `NOTION_TRAINING_DB` (Training Library) and `NOTION_TRAINING_DONE_DB` (Notion Training Completions).
Shows videos with Status "Published", plus "Recorded" / "In progress" ones that have a video link. Phase 2 and unrecorded videos stay hidden.
