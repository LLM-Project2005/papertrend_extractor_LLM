import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

type SourceType = "batch" | "upload";
type RunStatus = "queued" | "processing" | "succeeded" | "failed";
type TrackKind = "single" | "multi";

interface CliOptions {
  inputDir: string;
  dryRun: boolean;
  contentJsonPath?: string;
  provider?: string;
  model?: string;
}

interface PaperRecord {
  id: number;
  year: string;
  title: string;
}

interface KeywordRecord {
  paper_id: number;
  topic: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
}

interface TrackRecord {
  paper_id: number;
  year: string;
  title: string;
  el: number;
  eli: number;
  lae: number;
  other: number;
}

interface PaperContentRecord {
  paper_id: number;
  raw_text?: string | null;
  abstract?: string | null;
  abstract_claims?: string | null;
  body?: string | null;
  methods?: string | null;
  results?: string | null;
  conclusion?: string | null;
  source_filename?: string | null;
  source_path?: string | null;
}

interface IngestionRunRecord {
  id?: string;
  source_type: SourceType;
  status: RunStatus;
  source_filename?: string;
  source_path?: string;
  provider?: string;
  model?: string;
  input_payload?: Record<string, unknown>;
  error_message?: string;
  completed_at?: string;
}

interface CanonicalDataset {
  papers: PaperRecord[];
  keywords: KeywordRecord[];
  tracksSingle: TrackRecord[];
  tracksMulti: TrackRecord[];
  contents: PaperContentRecord[];
}

interface TrackFileCandidate {
  filePath: string;
  rows: TrackRecord[];
  kind: TrackKind;
}

const DEFAULT_TRENDS_CSV = "Master_Trends_Archive.csv";
const DEFAULT_TRENDS_JSON = "Master_Trends_Archive.json";
const DEFAULT_CONTENT_JSON_CANDIDATES = [
  "Paper_Content_Archive.json",
  "paper_content.json",
  "papers_full.json",
];
const TRACK_FILE_PATTERN = /^EIL_Track.*\.csv$/i;
const KEYWORD_BATCH_SIZE = 500;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputDir: ".",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--input-dir" && argv[i + 1]) {
      options.inputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--content-json" && argv[i + 1]) {
      options.contentJsonPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--provider" && argv[i + 1]) {
      options.provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--model" && argv[i + 1]) {
      options.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith("--") && options.inputDir === ".") {
      options.inputDir = arg;
    }
  }

  return options;
}

function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
}

function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((candidate) =>
    candidate.some((value) => value.trim().length > 0)
  );
  if (nonEmptyRows.length === 0) {
    return [];
  }

  const headers = nonEmptyRows[0].map((value) => normalizeHeader(value));
  return nonEmptyRows.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] ?? "").trim();
    });
    return record;
  });
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHeaderKey(value: string): string {
  return normalizeHeader(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveTrackColumn(header: string): keyof Pick<
  TrackRecord,
  "el" | "eli" | "lae" | "other"
> | null {
  const key = normalizeHeaderKey(header);
  if (key === "el" || key.includes("englishlinguistics")) return "el";
  if (key === "eli" || key.includes("englishlanguageinstruction")) return "eli";
  if (key === "lae" || key.includes("languageassessmentevaluation")) return "lae";
  if (key === "other") return "other";
  return null;
}

function toInteger(value: string | number | undefined | null, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBinary(value: string | number | undefined | null): number {
  return toInteger(value) > 0 ? 1 : 0;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function loadTrends(inputDir: string): KeywordRecord[] {
  const csvPath = path.join(inputDir, DEFAULT_TRENDS_CSV);
  const jsonPath = path.join(inputDir, DEFAULT_TRENDS_JSON);

  if (fileExists(csvPath)) {
    return parseCsv(readTextFile(csvPath)).map((row) => ({
      paper_id: toInteger(row.paper_id),
      topic: row.topic ?? "",
      keyword: row.keyword ?? "",
      keyword_frequency: toInteger(row.keyword_frequency, 1),
      evidence: row.evidence ?? "",
    }));
  }

  if (fileExists(jsonPath)) {
    const raw = JSON.parse(readTextFile(jsonPath));
    const records = Array.isArray(raw) ? raw : raw?.rows;
    if (!Array.isArray(records)) {
      throw new Error(`Unsupported JSON format in ${jsonPath}`);
    }
    return records.map((row) => ({
      paper_id: toInteger(row.paper_id),
      topic: String(row.topic ?? ""),
      keyword: String(row.keyword ?? ""),
      keyword_frequency: toInteger(row.keyword_frequency, 1),
      evidence: String(row.evidence ?? ""),
    }));
  }

  return [];
}

function buildPaperLookup(
  keywords: KeywordRecord[],
  trackRows: TrackRecord[],
  contentRows: PaperContentRecord[]
): Map<number, PaperRecord> {
  const papers = new Map<number, PaperRecord>();

  keywords.forEach((keyword) => {
    if (!papers.has(keyword.paper_id)) {
      papers.set(keyword.paper_id, { id: keyword.paper_id, year: "", title: "" });
    }
  });

  trackRows.forEach((track) => {
    papers.set(track.paper_id, {
      id: track.paper_id,
      year: track.year,
      title: track.title,
    });
  });

  contentRows.forEach((content) => {
    if (!papers.has(content.paper_id)) {
      papers.set(content.paper_id, {
        id: content.paper_id,
        year: "",
        title: "",
      });
    }
  });

  return papers;
}

function loadTrendMetadata(inputDir: string): Map<number, PaperRecord> {
  const csvPath = path.join(inputDir, DEFAULT_TRENDS_CSV);
  const jsonPath = path.join(inputDir, DEFAULT_TRENDS_JSON);
  let rows: Record<string, string>[] = [];

  if (fileExists(csvPath)) {
    rows = parseCsv(readTextFile(csvPath));
  } else if (fileExists(jsonPath)) {
    const raw = JSON.parse(readTextFile(jsonPath));
    const records = Array.isArray(raw) ? raw : raw?.rows;
    if (Array.isArray(records)) {
      rows = records.map((record) => ({
        paper_id: String(record.paper_id ?? ""),
        year: String(record.year ?? ""),
        title: String(record.title ?? ""),
      }));
    }
  }

  const papers = new Map<number, PaperRecord>();
  rows.forEach((row) => {
    const paperId = toInteger(row.paper_id);
    if (!paperId) return;
    if (!papers.has(paperId)) {
      papers.set(paperId, {
        id: paperId,
        year: String(row.year ?? ""),
        title: String(row.title ?? ""),
      });
    }
  });
  return papers;
}

function parseTrackFile(filePath: string): TrackFileCandidate {
  const rows = parseCsv(readTextFile(filePath));
  const normalizedRows: TrackRecord[] = rows.map((row) => {
    const record: TrackRecord = {
      paper_id: toInteger(row.paper_id),
      year: String(row.year ?? ""),
      title: String(row.title ?? ""),
      el: 0,
      eli: 0,
      lae: 0,
      other: 0,
    };

    Object.entries(row).forEach(([header, value]) => {
      const column = resolveTrackColumn(header);
      if (column) {
        record[column] = toBinary(value);
      }
    });

    return record;
  });

  const lowerName = path.basename(filePath).toLowerCase();
  const inferredKind: TrackKind =
    lowerName.includes("single")
      ? "single"
      : lowerName.includes("onehot") || lowerName.includes("multi")
        ? "multi"
        : normalizedRows.some((row) => row.el + row.eli + row.lae + row.other > 1)
          ? "multi"
          : "single";

  return {
    filePath,
    rows: normalizedRows,
    kind: inferredKind,
  };
}

function loadTrackFiles(inputDir: string): {
  tracksSingle: TrackRecord[];
  tracksMulti: TrackRecord[];
} {
  const candidates = fs
    .readdirSync(inputDir)
    .filter((name) => TRACK_FILE_PATTERN.test(name))
    .map((name) => parseTrackFile(path.join(inputDir, name)));

  const single = candidates.find((candidate) => candidate.kind === "single");
  const multi = candidates.find((candidate) => candidate.kind === "multi");

  return {
    tracksSingle: single?.rows ?? [],
    tracksMulti: multi?.rows ?? [],
  };
}

function resolveContentJsonPath(inputDir: string, explicitPath?: string): string | null {
  if (explicitPath && fileExists(explicitPath)) {
    return explicitPath;
  }

  for (const candidate of DEFAULT_CONTENT_JSON_CANDIDATES) {
    const candidatePath = path.join(inputDir, candidate);
    if (fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function resolvePaperIdByIdentity(
  paperLookup: Map<number, PaperRecord>,
  year: string | undefined,
  title: string | undefined
): number | null {
  if (!year || !title) {
    return null;
  }

  for (const paper of paperLookup.values()) {
    if (paper.year === year && paper.title === title) {
      return paper.id;
    }
  }

  return null;
}

function loadPaperContent(
  inputDir: string,
  paperLookup: Map<number, PaperRecord>,
  explicitPath?: string
): PaperContentRecord[] {
  const contentJsonPath = resolveContentJsonPath(inputDir, explicitPath);
  if (!contentJsonPath) {
    return [];
  }

  const raw = JSON.parse(readTextFile(contentJsonPath));
  const rows = Array.isArray(raw) ? raw : raw?.papers ?? raw?.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`Unsupported content JSON format in ${contentJsonPath}`);
  }

  const results: PaperContentRecord[] = [];
  for (const row of rows) {
    const directPaperId = toInteger(row.paper_id);
    const resolvedPaperId =
      directPaperId || resolvePaperIdByIdentity(paperLookup, row.year, row.title);
    if (!resolvedPaperId) {
      continue;
    }

    results.push({
      paper_id: resolvedPaperId,
      raw_text: row.raw_text ?? null,
      abstract: row.abstract ?? null,
      abstract_claims: row.abstract_claims ?? row.abstract ?? null,
      body: row.body ?? null,
      methods: row.methods ?? null,
      results: row.results ?? null,
      conclusion: row.conclusion ?? null,
      source_filename: row.source_filename ?? row.filename ?? null,
      source_path: row.source_path ?? row.pdf_path ?? null,
    });
  }

  return results;
}

function assembleDataset(inputDir: string, contentJsonPath?: string): CanonicalDataset {
  const trendRows = loadTrends(inputDir);
  const trendMetadata = loadTrendMetadata(inputDir);
  const { tracksSingle, tracksMulti } = loadTrackFiles(inputDir);
  const trackRows = [...tracksSingle, ...tracksMulti];
  const basePaperLookup = new Map<number, PaperRecord>(trendMetadata);

  trackRows.forEach((track) => {
    if (!basePaperLookup.has(track.paper_id)) {
      basePaperLookup.set(track.paper_id, {
        id: track.paper_id,
        year: track.year,
        title: track.title,
      });
    }
  });

  const contents = loadPaperContent(inputDir, basePaperLookup, contentJsonPath);
  const mergedLookup = buildPaperLookup(trendRows, trackRows, contents);

  trendMetadata.forEach((paper, paperId) => {
    mergedLookup.set(paperId, {
      id: paperId,
      year: paper.year,
      title: paper.title,
    });
  });

  tracksSingle.forEach((track) => {
    const paper = mergedLookup.get(track.paper_id);
    if (paper) {
      paper.year = paper.year || track.year;
      paper.title = paper.title || track.title;
    }
  });

  tracksMulti.forEach((track) => {
    const paper = mergedLookup.get(track.paper_id);
    if (paper) {
      paper.year = paper.year || track.year;
      paper.title = paper.title || track.title;
    }
  });

  return {
    papers: [...mergedLookup.values()].filter(
      (paper) => paper.id > 0 && (paper.title.length > 0 || paper.year.length > 0)
    ),
    keywords: trendRows,
    tracksSingle,
    tracksMulti,
    contents,
  };
}

async function insertRun(
  supabase: SupabaseClient,
  record: IngestionRunRecord
): Promise<string> {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .insert(record)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create ingestion run: ${error.message}`);
  }

  return String(data.id);
}

async function updateRun(
  supabase: SupabaseClient,
  runId: string,
  patch: Partial<IngestionRunRecord>
): Promise<void> {
  const { error } = await supabase
    .from("ingestion_runs")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Failed to update ingestion run ${runId}: ${error.message}`);
  }
}

async function replaceKeywords(
  supabase: SupabaseClient,
  paperIds: number[],
  rows: KeywordRecord[]
): Promise<void> {
  if (paperIds.length === 0) return;

  const { error: deleteError } = await supabase
    .from("paper_keywords")
    .delete()
    .in("paper_id", paperIds);

  if (deleteError) {
    throw new Error(`Failed to clear existing keywords: ${deleteError.message}`);
  }

  for (const batch of chunk(rows, KEYWORD_BATCH_SIZE)) {
    const { error } = await supabase.from("paper_keywords").insert(batch);
    if (error) {
      throw new Error(`Failed to insert keyword batch: ${error.message}`);
    }
  }
}

async function syncDataset(
  supabase: SupabaseClient,
  dataset: CanonicalDataset,
  options: CliOptions
): Promise<string> {
  const runId = await insertRun(supabase, {
    source_type: "batch",
    status: "processing",
    source_path: path.resolve(options.inputDir),
    provider: options.provider,
    model: options.model,
    input_payload: {
      paperCount: dataset.papers.length,
      keywordCount: dataset.keywords.length,
      singleTrackCount: dataset.tracksSingle.length,
      multiTrackCount: dataset.tracksMulti.length,
      contentCount: dataset.contents.length,
      contentJsonPath: options.contentJsonPath ?? null,
    },
  });

  try {
    if (dataset.papers.length > 0) {
      const { error } = await supabase
        .from("papers")
        .upsert(dataset.papers, { onConflict: "id" });
      if (error) {
        throw new Error(`Failed to upsert papers: ${error.message}`);
      }
    }

    const paperIds = dataset.papers.map((paper) => paper.id);
    await replaceKeywords(supabase, paperIds, dataset.keywords);

    if (dataset.tracksSingle.length > 0) {
      const trackRows = dataset.tracksSingle.map(({ year, title, ...track }) => track);
      const { error } = await supabase
        .from("paper_tracks_single")
        .upsert(trackRows, { onConflict: "paper_id" });
      if (error) {
        throw new Error(`Failed to upsert single-label tracks: ${error.message}`);
      }
    }

    if (dataset.tracksMulti.length > 0) {
      const trackRows = dataset.tracksMulti.map(({ year, title, ...track }) => track);
      const { error } = await supabase
        .from("paper_tracks_multi")
        .upsert(trackRows, { onConflict: "paper_id" });
      if (error) {
        throw new Error(`Failed to upsert multi-label tracks: ${error.message}`);
      }
    }

    if (dataset.contents.length > 0) {
      const contentRows = dataset.contents.map((content) => ({
        ...content,
        ingestion_run_id: runId,
      }));
      const { error } = await supabase
        .from("paper_content")
        .upsert(contentRows, { onConflict: "paper_id" });
      if (error) {
        throw new Error(`Failed to upsert paper content: ${error.message}`);
      }
    }

    await updateRun(supabase, runId, {
      status: "succeeded",
      completed_at: new Date().toISOString(),
    });

    return runId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateRun(supabase, runId, {
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    });
    throw error;
  }
}

function createSupabaseClient(): SupabaseClient {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function printSummary(dataset: CanonicalDataset, runId?: string): void {
  console.log("");
  console.log(`Papers: ${dataset.papers.length}`);
  console.log(`Keyword rows: ${dataset.keywords.length}`);
  console.log(`Single-label track rows: ${dataset.tracksSingle.length}`);
  console.log(`Multi-label track rows: ${dataset.tracksMulti.length}`);
  console.log(`Paper content rows: ${dataset.contents.length}`);
  if (runId) {
    console.log(`Ingestion run: ${runId}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(options.inputDir);

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  console.log(`Import source: ${inputDir}`);
  if (options.contentJsonPath) {
    console.log(`Content JSON: ${path.resolve(options.contentJsonPath)}`);
  }

  const dataset = assembleDataset(inputDir, options.contentJsonPath);
  printSummary(dataset);

  if (options.dryRun) {
    console.log("");
    console.log("Dry run complete. No Supabase writes were performed.");
    return;
  }

  const supabase = createSupabaseClient();
  const runId = await syncDataset(supabase, dataset, options);
  printSummary(dataset, runId);
  console.log("");
  console.log("Sync complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
