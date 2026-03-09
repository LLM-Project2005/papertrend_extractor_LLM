/**
 * import-csv.ts
 * ─────────────
 * Reads the three CSV files produced by the LLM extraction pipeline
 * and inserts them into Supabase.
 *
 * Usage:
 *   set SUPABASE_URL=https://xxx.supabase.co
 *   set SUPABASE_SERVICE_KEY=eyJ...
 *   npx tsx scripts/import-csv.ts "C:/path/to/csv/folder"
 *
 * The folder should contain:
 *   - Master_Trends_Archive.csv
 *   - EIL_Track_10years1.csv
 *   - EIL_Track_OneHot_Final.csv
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Error: set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY env vars."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/* ── Tiny CSV parser (handles basic quoting) ───────────────── */
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/);
  const headers = splitRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h.trim()] = (values[i] ?? "").trim()));
    return row;
  });
}

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* ── Main import logic ─────────────────────────────────────── */
async function importData(csvDir: string) {
  console.log(`Importing from: ${csvDir}\n`);

  // 1. Master_Trends_Archive.csv  →  papers + paper_keywords
  const trendsPath = path.join(csvDir, "Master_Trends_Archive.csv");
  if (fs.existsSync(trendsPath)) {
    const rows = parseCSV(fs.readFileSync(trendsPath, "utf-8"));
    console.log(`Read ${rows.length} trend rows`);

    // Unique papers
    const papers = new Map<number, { id: number; year: string; title: string }>();
    for (const r of rows) {
      const id = parseInt(r.paper_id);
      if (!papers.has(id)) papers.set(id, { id, year: r.year, title: r.title });
    }

    const { error: pErr } = await supabase
      .from("papers")
      .upsert(Array.from(papers.values()), { onConflict: "id" });
    if (pErr) console.error("  papers error:", pErr.message);
    else console.log(`  Upserted ${papers.size} papers`);

    // Keywords in batches of 500
    const kwRows = rows.map((r) => ({
      paper_id: parseInt(r.paper_id),
      topic: r.topic,
      keyword: r.keyword,
      keyword_frequency: parseInt(r.keyword_frequency) || 1,
      evidence: r.evidence ?? "",
    }));

    for (let i = 0; i < kwRows.length; i += 500) {
      const batch = kwRows.slice(i, i + 500);
      const { error } = await supabase.from("paper_keywords").insert(batch);
      if (error) console.error(`  keywords batch ${i} error:`, error.message);
    }
    console.log(`  Inserted ${kwRows.length} keyword rows`);
  } else {
    console.log("  Master_Trends_Archive.csv not found — skipping.");
  }

  // 2. EIL_Track_10years1.csv  →  paper_tracks_single
  const singlePath = path.join(csvDir, "EIL_Track_10years1.csv");
  if (fs.existsSync(singlePath)) {
    const rows = parseCSV(fs.readFileSync(singlePath, "utf-8"));
    const data = rows.map((r) => ({
      paper_id: parseInt(r.paper_id),
      el: parseInt(r.EL) || 0,
      eli: parseInt(r.ELI) || 0,
      lae: parseInt(r.LAE) || 0,
      other: parseInt(r.Other) || 0,
    }));
    const { error } = await supabase
      .from("paper_tracks_single")
      .upsert(data, { onConflict: "paper_id" });
    if (error) console.error("  single-track error:", error.message);
    else console.log(`  Upserted ${data.length} single-track rows`);
  } else {
    console.log("  EIL_Track_10years1.csv not found — skipping.");
  }

  // 3. EIL_Track_OneHot_Final.csv  →  paper_tracks_multi
  const multiPath = path.join(csvDir, "EIL_Track_OneHot_Final.csv");
  if (fs.existsSync(multiPath)) {
    const rows = parseCSV(fs.readFileSync(multiPath, "utf-8"));
    const data = rows.map((r) => ({
      paper_id: parseInt(r.paper_id),
      el: parseInt(r.EL) || 0,
      eli: parseInt(r.ELI) || 0,
      lae: parseInt(r.LAE) || 0,
      other: parseInt(r.Other) || 0,
    }));
    const { error } = await supabase
      .from("paper_tracks_multi")
      .upsert(data, { onConflict: "paper_id" });
    if (error) console.error("  multi-track error:", error.message);
    else console.log(`  Upserted ${data.length} multi-track rows`);
  } else {
    console.log("  EIL_Track_OneHot_Final.csv not found — skipping.");
  }

  console.log("\nDone!");
}

const csvDir = process.argv[2] || ".";
importData(csvDir).catch(console.error);
