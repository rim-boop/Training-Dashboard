# Training Compliance Dashboard

A live dashboard on top of Notion. You edit three Notion databases, and the dashboard shows who is compliant, what's due soon, what's overdue and what's missing. Nobody needs a Claude or Notion account to view it, only the link.

- `index.html` is the dashboard (Overview heatmap, By Employee, By Training, Calendar). It refreshes from Notion every minute.
- `api/dashboard.js` is a small server function. It holds your Notion key and reads the three databases.

## How the statuses are worked out

For every active person × every training that applies to their role:

| Status | Rule |
|---|---|
| Not completed | No completion record yet |
| Compliant | Completed, and next due date is more than 60 days away (or the training is one-time) |
| Due soon | Next due date is within 60 days |
| Overdue | Next due date has passed |
| Not applicable | The training's Relevant Role doesn't include the person's role or "All Staff" |

Next due date = latest Completed On + Frequency (months). A completion with no Manager Signed On date shows as "Awaiting sign-off". People with Employment Status "Former" are left out.

## Setup (about 15 minutes)

1. **Create a Notion key.** Go to notion.so/profile/integrations → New integration → name it "Training Dashboard", choose your workspace, and set capabilities to **Read content** only. Copy the Internal Integration Secret.
2. **Give it access.** Open the Notion page **Training Compliance — Demo Data** → ••• → Connections → add "Training Dashboard". The three databases inside it are included.
3. **Put the files on GitHub.** Create a private repository and upload `index.html`, `package.json`, `README.md` and the `api` folder.
4. **Deploy on Vercel.** Sign in at vercel.com with GitHub (the free Hobby plan is enough) → Add New → Project → import the repository. Before you click Deploy, add these environment variables:

   | Name | Value |
   |---|---|
   | `NOTION_TOKEN` | the secret from step 1 |
   | `TEAM_DB` | `d851f02168764a019956e8c7eb38a87a` |
   | `TRAININGS_DB` | `c8a738470c2b4e4db59259932a920e69` |
   | `COMPLETIONS_DB` | `c2aab986e44b48149b32ff7b7f677769` |
   | `DASHBOARD_PASSWORD` | optional: set one if the link shouldn't be open to anyone who has it |

5. **Open the link** Vercel gives you, e.g. `training-dashboard.vercel.app`.

Changing an environment variable later needs a redeploy (Vercel → Deployments → ••• → Redeploy).

## Day-to-day use in Notion

- New hire: add them to **Team** with their role. Their required trainings appear as "Not completed".
- Someone completes a training: add a row to **Completions** with Employee, Training and Completed On. For a renewal, add a new row; the dashboard uses the latest one.
- Manager signs off: fill in Manager Signed On.
- New training: add it to **Trainings** with Relevant Role and Frequency (months), with 0 meaning one-time.

## Pointing it at STOKE (or any other workspace)

1. Connect the integration to the STOKE databases (Team Directory, Training Library, Training Completion).
2. Set `TEAM_DB`, `TRAININGS_DB` and `COMPLETIONS_DB` to their IDs. The ID is the 32-character code in the database's link.
3. The demo databases use the same property names as STOKE (Name, Role, Employment Status, Hire Date / Item, Relevant Role, Frequency (months), Category / Employee, Training, Completed On, Manager Signed On), so the `PROPS` block in `api/dashboard.js` works as it is. For another workspace, edit `PROPS` to match its property names.
4. STOKE's Team Directory has roles the Training Library doesn't list (Lead Provider, Front Desk Coordinator, Marketing Manager…). Either add those roles to each training's "Relevant Role", or rename them to match, otherwise those people only get "All Staff" trainings.
