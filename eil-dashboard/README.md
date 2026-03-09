# EIL Research Trend Dashboard — Next.js + Supabase

A **Next.js 14** (App Router, TypeScript, Tailwind CSS) dashboard that visualises outputs from the LLM-based extraction pipeline for English as an International Language research. Designed for one-click deployment on **Vercel** with **Supabase** as the database backend.

> Without Supabase credentials the app shows realistic **mock data** so you can preview instantly.

---

## Quick Start (Local)

```bash
cd eil-dashboard
npm install
npm run dev
```

Open **http://localhost:3000** — the dashboard renders with mock data immediately.

---

## Project Structure

```
eil-dashboard/
├── src/
│   ├── app/              # Next.js App Router (layout, page, globals.css)
│   ├── components/       # Sidebar, MetricCard, Heatmap, tab panels
│   ├── hooks/            # useData — fetches from Supabase or falls back to mock
│   ├── lib/              # supabase client, constants, mock data generator
│   └── types/            # TypeScript interfaces
├── supabase/
│   └── schema.sql        # Full Supabase schema (tables, views, RLS, indexes)
├── scripts/
│   └── import-csv.ts     # Script to import CSV data into Supabase
├── package.json
├── tailwind.config.ts
└── .env.local.example    # Copy to .env.local and fill in your Supabase credentials
```

---

## Supabase Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Note down your:
   - **Project URL** — `https://YOUR_PROJECT_REF.supabase.co`
   - **Anon (public) key** — found in _Settings → API → Project API keys_
   - **Service role key** — same page (keep this secret, only for import scripts)

### 2. Run the Schema SQL

1. In your Supabase dashboard, go to **SQL Editor → New query**.
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Click **Run** — this creates:

| Table                   | Description                          |
|-------------------------|--------------------------------------|
| `papers`                | One row per paper (id, year, title)  |
| `paper_keywords`        | Keyword-level rows (topic, keyword, frequency, evidence) |
| `paper_tracks_single`   | Single-choice EIL track flags (EL, ELI, LAE, Other) |
| `paper_tracks_multi`    | Multi-label EIL track flags          |

Plus three **views** (`trends_flat`, `tracks_single_flat`, `tracks_multi_flat`) that the Next.js app reads directly.

### 3. Import Your CSV Data

Option A — **Use the import script:**

```bash
# Windows (set env vars first)
set SUPABASE_URL=https://xxx.supabase.co
set SUPABASE_SERVICE_KEY=eyJ...
npx tsx scripts/import-csv.ts "C:/path/to/your/csv/folder"
```

The script reads:
- `Master_Trends_Archive.csv` → `papers` + `paper_keywords`
- `EIL_Track_10years1.csv` → `paper_tracks_single`
- `EIL_Track_OneHot_Final.csv` → `paper_tracks_multi`

Option B — **Supabase CSV import** (manual):
1. In the Supabase dashboard, go to **Table Editor**.
2. Select a table → **Import data from CSV**.
3. Upload the corresponding CSV file.

### 4. Configure Environment Variables

Copy the example file and fill in your credentials:

```bash
copy .env.local.example .env.local
```

Edit `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## Vercel Deployment

1. Push this `eil-dashboard` folder to a **GitHub** (or GitLab/Bitbucket) repository.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Vercel auto-detects Next.js — no build config needed.
4. Add environment variables in **Settings → Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Click **Deploy** ✅

That's it — your dashboard is live at `https://your-project.vercel.app`.

---

## Database Schema Diagram

```
┌──────────────────┐
│     papers       │
├──────────────────┤
│ id   (PK, BIGINT)│───┐
│ year (TEXT)       │   │
│ title (TEXT)      │   │
│ created_at       │   │
└──────────────────┘   │
                       │  1:N
┌──────────────────┐   │
│ paper_keywords   │   │
├──────────────────┤   │
│ id (PK, SERIAL)  │   │
│ paper_id (FK) ───┼───┘
│ topic            │
│ keyword          │
│ keyword_frequency│
│ evidence         │
│ created_at       │
└──────────────────┘

┌─────────────────────┐     ┌─────────────────────┐
│ paper_tracks_single │     │ paper_tracks_multi   │
├─────────────────────┤     ├─────────────────────┤
│ paper_id (PK, FK)   │     │ paper_id (PK, FK)   │
│ el   (0/1)          │     │ el   (0/1)          │
│ eli  (0/1)          │     │ eli  (0/1)          │
│ lae  (0/1)          │     │ lae  (0/1)          │
│ other (0/1)         │     │ other (0/1)         │
│ created_at          │     │ created_at          │
└─────────────────────┘     └─────────────────────┘
```

---

## Tech Stack

| Layer      | Technology              |
|------------|-------------------------|
| Framework  | Next.js 14 (App Router) |
| Language   | TypeScript              |
| Styling    | Tailwind CSS            |
| Charts     | Recharts                |
| Database   | Supabase (PostgreSQL)   |
| Hosting    | Vercel                  |

---

## Features (matching the original Streamlit dashboard)

- **Overview** — metric cards, papers-per-year bar chart, track donut charts
- **Trend Analysis** — topic area chart, emerging/declining topics, keyword heatmap
- **Track Analysis** — stacked bar chart, co-occurrence matrix, top topics per track
- **Keyword Explorer** — treemap, sortable table, keyword timeline
- **Paper Explorer** — searchable table, paper detail view with keyword evidence
- **Sidebar Filters** — year range and track selection (global)
- **Mock Data Fallback** — works without Supabase for previewing
