# Mentor Q&A questionnaire

A one-question-at-a-time form for collecting mentor-written reference answers to 20 student-support questions. Every answer and the final no-generative-AI confirmation are required.

## Production architecture

- Vercel serves the static files in `public/`.
- `POST /api/submissions` runs as a Vercel Function in Frankfurt (`fra1`).
- The function validates the complete submission again and writes it to Supabase.
- The Supabase secret key is available only to the server function. It is never sent to the browser.
- The database stores answers, questionnaire version, confirmation, and start/completion times. The app does not intentionally collect names, email addresses, IP addresses, user agents, or clipboard-attempt telemetry.

## Deploy with Supabase and Vercel

### 1. Create the Supabase database

1. Create a Supabase project and select **Frankfurt (`eu-central-1`)** as its region.
2. Open **SQL Editor** in the project dashboard.
3. Copy and run [`supabase/schema.sql`](supabase/schema.sql).
4. In the project's API Keys settings, create or copy a server-side **secret key** (`sb_secret_...`). Do not use this key in browser code or commit it to Git.

The schema enables Row Level Security and gives the browser-facing `anon` and `authenticated` roles no access to the response table. Only the server-side secret role can insert and read rows.

### 2. Deploy the repository to Vercel

1. Put this project in a private GitHub, GitLab, or Bitbucket repository.
2. In Vercel, choose **Add New > Project**, import the repository, and use **Other** as the framework preset.
3. Keep the project root as the root directory. No build command is required.
4. Add these environment variables for **Production** (and Preview if preview deployments should accept submissions):

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | The project URL, such as `https://project-ref.supabase.co` |
| `SUPABASE_SECRET_KEY` | The server-only `sb_secret_...` key |
| `MENTOR_SUBMISSIONS_TABLE` | `mentor_submissions` (optional; this is the default) |

5. Deploy. Vercel will serve `public/index.html` and expose the function at `/api/submissions` on the same domain.
6. Submit one clearly labelled test response, confirm that one row appears in `public.mentor_submissions`, and remove the test row before real collection begins.

The checked-in [`vercel.json`](vercel.json) selects the Frankfurt function region and adds browser security headers. The example environment file contains placeholders only; never replace them with real secrets in a commit.

Official setup references: [Vercel Functions](https://vercel.com/docs/functions), [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region), [Supabase server-side API keys](https://supabase.com/docs/guides/getting-started/api-keys), and [Supabase regions](https://supabase.com/docs/guides/platform/regions).

### 3. Export the thesis data

Run [`supabase/export_responses.sql`](supabase/export_responses.sql) in the Supabase SQL Editor. Its result has one row per mentor and one column per question, which can be downloaded as CSV from the results panel.

Export the data regularly during collection and store the backup in an approved location. Supabase Free projects can be paused after low activity, and free projects do not include downloadable managed database backups. Wake and test the project before sending the questionnaire link to participants. See [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) and [database backups](https://supabase.com/docs/guides/platform/backups).

Vercel Hobby is intended for personal, non-commercial use. A personal master-thesis study will often fit that category, but use your university's approved hosting or a paid plan if the institution classifies the deployment differently. See the [Hobby plan](https://vercel.com/docs/plans/hobby) and [fair-use policy](https://vercel.com/docs/limits/fair-use-guidelines).

## Run and test locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The lightweight local server stores completed submissions as ignored JSON files under `data/submissions/`; it does not use Supabase. Existing local JSON submissions are not migrated automatically.

To exercise the Vercel/Supabase path locally, copy `.env.example` to `.env.local`, insert development credentials, and run `npx vercel dev`. Keep `.env.local` out of Git.

Run all automated checks with:

```bash
npm test
```

## Participant-side behavior

Draft answers are stored in the mentor's browser for up to seven days or until a successful submission, then removed. A mentor can discard a saved draft from the opening screen, which is helpful on a shared computer. If Supabase is temporarily unavailable, submission fails visibly and the browser draft remains available for retrying.

The visible question cannot be selected, dragged, or copied through ordinary page controls. Paste and drag/drop insertion are blocked in the response field. These controls deter casual transfer to and from AI tools, but no website can guarantee independent authorship: screenshots, browser developer tools, extensions, another device, and manual retyping remain possible. The final confirmation is the actual attestation.

The restrictions are scoped to question text and answer insertion so keyboard navigation, screen readers, spellcheck, and editing of the mentor's own typed response continue to work.
