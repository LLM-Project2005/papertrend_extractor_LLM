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

Optional but recommended for task-level model routing:

```bash
MODEL_GATEWAY=openrouter
MODEL_POLICY_PRESET=conservative
MODEL_TASK_METADATA=google/gemini-2.5-flash-lite
MODEL_TASK_METADATA_FALLBACK=openai/gpt-4.1-nano
MODEL_TASK_CHAT_SYNTHESIS=google/gemini-2.5-flash
MODEL_TASK_CHAT_SYNTHESIS_FALLBACK=openai/gpt-4.1-mini
ENABLE_CHAT_TOOL_CALLING=false
CHAT_TOOL_MAX_STEPS=3
```

You can also override any individual routing task with `MODEL_TASK_<TASK>` and `MODEL_TASK_<TASK>_FALLBACK`, for example:

```bash
MODEL_TASK_SEGMENTATION=openai/gpt-4.1-mini
MODEL_TASK_SEGMENTATION_FALLBACK=google/gemini-2.5-flash
MODEL_TASK_QUERY_EXPANSION=google/gemini-2.5-flash-lite
MODEL_TASK_QUERY_EXPANSION_FALLBACK=openai/gpt-4.1-nano
```

Optional but recommended for the node-first interactive backend:

```bash
PYTHON_NODE_SERVICE_URL=http://127.0.0.1:8001
```

Optional for the Google Drive connector:

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_DRIVE_REDIRECT_URI=https://YOUR_APP_DOMAIN/api/integrations/google-drive/callback
GOOGLE_PICKER_API_KEY=your-google-picker-api-key
```

## Local development

```bash
cd eil-dashboard
npm install
npm run dev
```

Run the Python node service from the repo root in a separate terminal:

```bash
python node_service.py --host 127.0.0.1 --port 8001
```

Optional model-routing bake-off from the repo root:

```bash
python scripts/evaluate_model_routing.py "C:/path/to/paper-a.pdf" "C:/path/to/paper-b.pdf" --output model-routing-eval.json
```

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Add the public and service-role keys to your env file.

The schema also creates a private storage bucket named `paper-uploads` for the admin upload flow.

## Batch sync from notebook outputs

The notebook is still useful for experimentation, but it is not the production runtime. Its current form still includes notebook-only setup cells, local test paths, and interactive evaluation steps. For controlled backfills, you can still run it and sync the outputs into Supabase with:

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

## Automatic queued-upload processing

The production-oriented path for uploaded PDFs is the queue worker in `worker/process_ingestion_queue.py`.

What it does:

1. polls `ingestion_runs` for queued upload jobs
2. downloads the PDF from the private `paper-uploads` bucket
3. extracts text with `pymupdf4llm` or `PyMuPDF`
4. asks the configured OpenAI-compatible model for structured sections, keywords, and track labels
5. writes the normalized rows into:
   - `papers`
   - `paper_keywords`
   - `paper_tracks_single`
   - `paper_tracks_multi`
   - `paper_content`
6. marks the run as `succeeded` or `failed`

Install the worker dependencies in the machine that will run background processing:

```bash
cd eil-dashboard
python -m pip install -r worker/requirements.txt
```

Run one pass:

```bash
npm run worker:queue:once
```

Run continuously:

```bash
npm run worker:queue
```

Google Drive note:

- local PDF uploads are downloaded from Supabase Storage
- Google Drive queued runs are downloaded directly from Google Drive using the stored connector token
- the worker machine therefore also needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` when Google Drive runs are enabled

Recommended deployment model:

- keep Next.js on Vercel
- run the queue worker on a separate VM, container, or Cloud Run job
- run the Python node service beside the worker, against the same Supabase project
- point both at the same Supabase project and the same `OPENAI_*` environment variables

## Admin upload flow

The admin page at `/admin/import` does two things:

1. uploads PDFs into Supabase Storage
2. creates queued `ingestion_runs`

It does not run the heavy extraction inside Next.js. The long-running extraction now belongs to the queue worker, not the notebook UI itself.

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
