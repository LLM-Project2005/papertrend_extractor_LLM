# EIL Research Dashboard

Next.js 14 dashboard and chat interface for the EIL paper-analysis pipeline, backed by Supabase.

## What is in this app

- Dashboard at `/`
- Corpus-grounded chat at `/chat`
- Admin import UI at `/admin/import`
- Batch sync script for notebook outputs
- Supabase schema for papers, canonical content, tracks, keywords, and ingestion runs

## Data model overview

The dashboard still reads the same flat contracts it used before:

- `trends_flat`
- `tracks_single_flat`
- `tracks_multi_flat`

Underneath that, the schema now supports a richer canonical store:

- `papers`
- `paper_content`
- `paper_keywords`
- `paper_tracks_single`
- `paper_tracks_multi`
- `ingestion_runs`
- `papers_full`

This keeps the current analytics UI compatible while making room for chat and upload-driven ingestion.

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in the values you need.

Required for dashboard reads:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

Required for admin upload routes and batch sync:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Required for the v1 admin import screen:

```bash
ADMIN_IMPORT_SECRET=choose-a-shared-secret
```

Optional for chat synthesis and future extraction interoperability:

```bash
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

## Local development

```bash
cd eil-dashboard
npm install
npm run dev
```

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Add the public and service-role keys to your env file.

The schema also creates a private storage bucket named `paper-uploads` for the admin upload flow.

## Batch sync from notebook outputs

The notebook remains the extraction engine in phase 1. After running it, sync the outputs into Supabase with:

```bash
npm run sync-supabase -- "C:/path/to/output-folder"
```

Useful flags:

```bash
npx tsx scripts/import-csv.ts "C:/path/to/output-folder" --dry-run
npx tsx scripts/import-csv.ts "C:/path/to/output-folder" --content-json "C:/path/to/paper_content.json"
npx tsx scripts/import-csv.ts "C:/path/to/output-folder" --provider OpenAI --model gpt-4.1-mini
```

The sync is idempotent per `paper_id`:

- papers are upserted
- keyword rows are replaced for imported papers
- track rows are upserted
- content rows are upserted when provided

The importer also normalizes both:

- short headers like `EL`, `ELI`, `LAE`, `Other`
- long multiline track headers from sample CSV exports

## Admin upload flow

The admin page at `/admin/import` does two things:

1. uploads PDFs into Supabase Storage
2. creates queued `ingestion_runs`

It does not run the heavy extraction inside Next.js. The long-running extraction still belongs to your external Python/notebook pipeline.

## Chat behavior

The chat route is corpus-grounded first:

- it looks across paper titles, extracted sections, keywords, topics, and tracks
- it cites relevant papers back to the dashboard
- if the corpus does not answer directly, it labels the response as broader guidance

Chat threads are not persisted in the database in v1.

## Vercel setup

Use one Vercel project for this app.

Important project setting:

- Set the Vercel Root Directory to `eil-dashboard`

Recommended branch setup:

- `main` = production branch
- `test` = preview branch

Preview deployments:

1. Create the local branch:

```bash
git switch -c test
```

2. Commit your work.
3. Push the branch:

```bash
git push -u origin test
```

4. Vercel will create a preview deployment automatically for `test`.

Because preview and production currently share the same Supabase project, keep database changes additive-only until you intentionally promote them.

## Verification

The current implementation has been verified with:

- `npm run build`
- dry-run sync against the provided sample track folder

The dry-run detected:

- 48 papers
- 48 single-label track rows
- 48 multi-label track rows

which confirms the new CSV normalization handles the sample file variants.
