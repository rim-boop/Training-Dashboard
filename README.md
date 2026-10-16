# My Trainings: live page on top of Notion

Two files:

- `index.html` is the page people open. It reloads from Notion every minute.
- `api/trainings.js` is a small server function. It holds the Notion secret, reads the database and returns only the rows for the person whose key is in the link.

## Setup (about 15 minutes)

1. **Create a Notion integration.** Go to notion.so/profile/integrations, then New integration, internal, with read content only. Copy the secret.
2. **Give it access to the database.** Open "Training Assignments (test)" in Notion, then ••• → Connections → add your integration.
3. **Put the two files on GitHub.** Make a new repo and upload `index.html` and the `api` folder as they are.
4. **Deploy on Vercel.** Go to vercel.com, Add New Project, import the repo, and add these three environment variables:
   - `NOTION_TOKEN` = the secret from step 1
   - `NOTION_DATABASE_ID` = `62bac4f9b2504759933460d28e1ae8fb`
   - `PEOPLE` = `{"k7f2-rim":"297d872b-594c-817b-bb05-0002022f3d90"}`
5. **Open your link:** `https://<your-project>.vercel.app/?key=k7f2-rim`

## Adding a team member

Add one entry to `PEOPLE` with a random key and their Notion user ID, then redeploy. Send them their link. Example:

`{"k7f2-rim":"297d…","q9x4-sarah":"<sarah's notion user id>"}`

Each person sees only rows where "Assigned to" contains them. Changing the key in the link without knowing another person's key returns nothing.

## Embedding it in Notion

Paste the link into a Notion page and choose **Embed**. Each person needs their own link, so this works best on their personal page or a member's own hub.

## Pointing it at STOKE later

Change `NOTION_DATABASE_ID` to Training Completion and update the three property names in `api/trainings.js` (`Training`, `Due`, `Status`). Training Completion needs an "Assigned to" person property first.
