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

- **Team**: Name, Role, Employment Status, Hire Date, **Access Key** (private key in their link), **Extra Trainings** (trainings assigned to this person on top of their role), **Personal Link** (formula that builds their link).
- **Trainings**: Item, Relevant Role, Frequency (months; 0 = one-time), Category, **Pass Mark (%)** (empty = 80), **Material Link** (what to read or watch before the quiz).
- **Quiz Questions**: Question, Training, Option A–D, Correct Answer (A–D), Order.
- **Completions**: Employee, Training, Completed On, Manager Signed On, **Score (%)**, **Result** (Passed / Retake required), **Source**, **Answers**.

## How statuses work

For every active person × every training that applies to them (by role, "All Staff", or Extra Trainings):

| Status | Rule |
|---|---|
| Not completed | No attempt yet |
| Retake required | The latest attempt scored below the training's pass mark |
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

- **New hire:** add them to Team with a Role and an Access Key (any 16 random letters and numbers). Copy their **Personal Link** from Notion and send it to them.
- **One-off assignment:** add the training to the person's Extra Trainings.
- **New quiz:** add rows to Quiz Questions linked to the training, and set its Pass Mark.
- **Lost or shared link:** change that person's Access Key. The old link stops working immediately.
- **Manager sign-off:** fill in Manager Signed On on the passing Completions row.
