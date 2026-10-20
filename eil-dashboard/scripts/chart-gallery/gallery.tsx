/*
 * The chart gallery (docs/38): every chart form, drawn by the real components
 * from the synthetic collections the tests use, as a reader would see them -
 * the Adaptive tab's cards and Chart mode's answers. build.mjs bundles it,
 * shoot.mjs screenshots it in light and dark, at phone and desktop width, and
 * checks every chart for overflow and overlapping text.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import InsightChart from "@/components/dashboard/InsightChart";
import ChatChartCard from "@/components/chat/ChatChartCard";
import ChatInsightCard from "@/components/chat/ChatInsightCard";
import { buildInsightCorpus, type InsightCorpus } from "@/lib/insights/corpus";
import { buildInsightReport } from "@/lib/insights/engine";
import { askVocabulary, runAskQuery, type AskQuery } from "@/lib/insights/ask";
import type { Insight } from "@/lib/insights/types";
import type { ChatChartPayload } from "@/components/chat/ChatClient";
import { SHAPES, corpusInput } from "../../tests/support/chart-corpora";

if (new URLSearchParams(location.search).get("theme") === "dark") document.documentElement.classList.add("dark");
const only = new URLSearchParams(location.search).get("only");

function collection(name: string) {
  const shape = SHAPES.find((entry) => entry.name.startsWith(name));
  if (!shape) throw new Error(`no collection ${name}`);
  const { input, profiles, titles } = corpusInput(shape);
  const corpus = buildInsightCorpus(input, profiles);
  return { shape, corpus, report: buildInsightReport(corpus), titles };
}

const view = (rows: AskQuery["rows"], more: Partial<AskQuery> = {}): AskQuery => ({ answerable: true, title: "", measure: "papers", rows, columns: null, focus: null, about: [], ...more });

function ask(corpus: InsightCorpus, query: AskQuery): Insight | string {
  const answer = runAskQuery(corpus, query);
  return "insight" in answer ? answer.insight : answer.unanswerable;
}

function Card({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section data-specimen={id} className="app-surface px-4 py-5 sm:px-6">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-mute">{label}</p>
      {children}
    </section>
  );
}

function InsightSpecimen({ id, label, insight, titles }: { id: string; label: string; insight: Insight | string; titles: Map<string, string> }) {
  return (
    <Card id={id} label={label}>
      {typeof insight === "string" ? (
        <p className="text-sm text-body">Unanswerable: {insight}</p>
      ) : (
        <>
          <h3 className="text-base font-semibold leading-6 text-ink">{insight.question}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-body">{insight.takeaway}</p>
          <div className="mt-5">
            <InsightChart insight={insight} onOpen={() => undefined} paperTitles={titles} />
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-xs leading-5 text-mute">{insight.basis}</p>
        </>
      )}
    </Card>
  );
}

/** Chat reading charts, as repository-chat and chart-reading build them. */
function readingCharts(): Array<{ id: string; label: string; chart: ChatChartPayload }> {
  const { corpus } = collection("thirty-six");
  const papers = corpus.papers.slice(0, 18);
  const byPaper = Object.fromEntries(papers.filter((paper) => paper.category).map((paper) => [String(paper.id), paper.category as string]));
  const base = { scopeLabel: "testtest (36 papers)", xKey: "label" as const, planner: { source: "llm" as const } };
  const words = papers.map((paper, index) => ({ label: paper.title, words: 4200 + ((index * 7919) % 6100), paperId: String(paper.id) })).sort((a, b) => b.words - a.words);
  const participants = [484, 210, 120, 96, 64, 49, 45, 40, 30, 28, 24, 15, 5].map((value, index) => ({ label: papers[index].title, Participants: value, paperId: String(papers[index].id) }));
  return [
    { id: "words-grouped", label: "Chart mode · words per paper, by research area (18 papers)", chart: { ...base, chartType: "bar", title: "Words per paper", metric: "word_count", yKeys: ["words"], data: words, groups: { label: "Research area", byPaper } } },
    { id: "words-five", label: "Chart mode · words per paper, five papers, one area", chart: { ...base, chartType: "bar", title: "Words per paper", metric: "word_count", yKeys: ["words"], data: words.slice(0, 5) } },
    { id: "participants", label: "Chart mode · participants in each study", chart: { ...base, chartType: "bar", title: "Participants in each study", metric: "reported_value", yKeys: ["Participants"], data: participants, groups: { label: "Research area", byPaper } } },
    {
      id: "countries",
      label: "Chart mode · countries, counted by papers that state one (squares)",
      chart: {
        ...base,
        chartType: "bar",
        title: "Where the studies were conducted",
        metric: "reported_value",
        yKeys: ["Papers"],
        data: [
          { label: "Thailand", Papers: 14 },
          { label: "China", Papers: 4 },
          { label: "Vietnam", Papers: 2 },
          { label: "Japan", Papers: 1 },
          { label: "Indonesia", Papers: 1 },
        ],
        sources: Array.from({ length: 22 }, (_, index) => ({ paperId: String(index + 1), title: `Paper ${index + 1}`, year: "2023", value: "Thailand", quote: "" })),
      },
    },
    {
      id: "sections",
      label: "Chart mode · words in each section, by paper (stacked)",
      chart: {
        ...base,
        chartType: "bar",
        title: "Words in each section, by paper",
        metric: "word_count",
        yKeys: ["Introduction", "Literature review", "Methods", "Results", "Discussion", "Conclusion"],
        stacked: true,
        data: papers.slice(0, 7).map((paper, index) => ({ label: paper.title, Introduction: 600 + index * 40, "Literature review": 1400 - index * 60, Methods: 900 + index * 30, Results: 1300 + index * 90, Discussion: 1000 - index * 20, Conclusion: 300 + index * 10 })),
      },
    },
    {
      id: "figures",
      label: "Chart mode · a paper's own figures (pre-test, post-test)",
      chart: {
        ...base,
        chartType: "bar",
        title: "Mean pre-test and post-test scores by group",
        metric: "paper_figures",
        yKeys: ["Pre-test", "Post-test"],
        data: [
          { label: "Experimental group", "Pre-test": 12.4, "Post-test": 17.9 },
          { label: "Control group", "Pre-test": 12.1, "Post-test": 13.2 },
          { label: "Delayed post-test, experimental", "Pre-test": 12.4, "Post-test": 16.8 },
        ],
      },
    },
    {
      id: "medians",
      label: "Chart mode · median participants per year (line)",
      chart: {
        ...base,
        chartType: "line",
        title: "Median participants per year",
        metric: "reported_value",
        yKeys: ["Median participants"],
        data: ["2015", "2016", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"].map((year, index) => ({ label: year, "Median participants": [40, 35, 60, 48, 52, 70, 64, 90, 75, 120][index] })),
      },
    },
    {
      id: "pie",
      label: "Chart mode · research approaches (a pie, four parts)",
      chart: {
        ...base,
        chartType: "pie",
        title: "Research approaches",
        metric: "reported_value",
        yKeys: ["Papers"],
        data: [
          { label: "Quantitative", Papers: 11 },
          { label: "Mixed methods", Papers: 7 },
          { label: "Qualitative", Papers: 5 },
          { label: "Not stated", Papers: 2 },
        ],
      },
    },
    {
      id: "pie-too-many",
      label: "Chart mode · a pie asked for with nine parts (drawn as bars)",
      chart: {
        ...base,
        chartType: "pie",
        title: "Data collection instruments",
        metric: "reported_value",
        yKeys: ["Papers"],
        data: ["Questionnaire", "Interview", "Test", "Observation", "Writing task", "Think-aloud", "Journal", "Corpus", "Rubric"].map((label, index) => ({ label, Papers: [16, 12, 9, 6, 5, 3, 2, 2, 1][index] })),
      },
    },
    {
      id: "terms",
      label: "Chart mode · how often three terms appear, by paper",
      chart: {
        ...base,
        chartType: "bar",
        title: "assessment, writing, speaking occurrences by paper",
        metric: "word_count",
        yKeys: ["assessment", "writing", "speaking"],
        data: papers.slice(0, 6).map((paper, index) => ({ label: paper.title, assessment: [42, 3, 0, 18, 7, 1][index], writing: [5, 61, 2, 9, 30, 0][index], speaking: [0, 2, 47, 1, 4, 22][index] })),
      },
    },
    {
      id: "table",
      label: "Chart mode · a table asked for",
      chart: { ...base, chartType: "table", title: "Participants and weeks", metric: "reported_value", yKeys: ["Participants", "Weeks"], data: participants.slice(0, 6).map((row, index) => ({ label: row.label, Participants: row.Participants, Weeks: [12, 9, 10, 6, 17, 4][index] })) },
    },
  ];
}

function Gallery() {
  const specimens: React.ReactNode[] = [];
  const add = (id: string, node: React.ReactNode) => {
    if (!only || id.startsWith(only)) specimens.push(<React.Fragment key={id}>{node}</React.Fragment>);
  };

  // A repository of six papers, as the user's EIL pipeline check.
  const six = collection("six papers (the EIL");
  six.report.insights.forEach((insight) => add(`six-${insight.id}`, <InsightSpecimen id={`six-${insight.id}`} label={`6 papers · Adaptive tab · ${insight.id}`} insight={insight} titles={six.titles} />));
  const sixVocab = askVocabulary(six.corpus, 2);
  const sixViews: Array<[string, AskQuery]> = [
    ["themes", view("theme")],
    ["methods", view("method")],
    ["years", view("year")],
    ["method-by-theme", view("method", { columns: "theme" })],
    ["about", view("method", { focus: { dimension: "theme", values: [sixVocab.theme[0]] }, about: [sixVocab.method[0]] })],
    ["narrowed", view("theme", { focus: { dimension: "method", values: [sixVocab.method[0]] } })],
    ["research-areas", view("category")],
  ];
  sixViews.forEach(([name, query]) => add(`six-ask-${name}`, <InsightSpecimen id={`six-ask-${name}`} label={`6 papers · asked · ${name}`} insight={ask(six.corpus, query)} titles={six.titles} />));

  const unique = collection("six papers, every theme unique");
  add("unique-themes", <InsightSpecimen id="unique-themes" label="6 papers, every theme its own · asked · themes" insight={ask(unique.corpus, view("theme"))} titles={unique.titles} />);
  const one = collection("one paper");
  one.report.insights.forEach((insight) => add(`one-${insight.id}`, <InsightSpecimen id={`one-${insight.id}`} label={`1 paper · Adaptive tab · ${insight.id}`} insight={insight} titles={one.titles} />));

  const test = collection("thirty-six");
  test.report.insights.slice(0, 6).forEach((insight) => add(`36-${insight.id}`, <InsightSpecimen id={`36-${insight.id}`} label={`36 papers · Adaptive tab · ${insight.id}`} insight={insight} titles={test.titles} />));
  const testVocab = askVocabulary(test.corpus, 2);
  const testViews: Array<[string, AskQuery]> = [
    ["themes", view("theme")],
    ["years", view("year")],
    ["themes-change", view("theme", { measure: "change" })],
    ["narrowed", view("method", { focus: { dimension: "theme", values: [testVocab.theme[0]] } })],
    ["compared", view("theme", { about: testVocab.theme.slice(0, 2) })],
    ["category-by-year", view("category", { columns: "year" })],
  ];
  testViews.forEach(([name, query]) => add(`36-ask-${name}`, <InsightSpecimen id={`36-ask-${name}`} label={`36 papers · asked · ${name}`} insight={ask(test.corpus, query)} titles={test.titles} />));
  // The same view in the chat, as Chart mode draws it.
  const chatInsight = ask(test.corpus, view("theme"));
  if (typeof chatInsight !== "string") {
    add("36-chat-themes", (
      <Card id="36-chat-themes" label="36 papers · Chart mode · themes (a dashboard view in the chat)">
        <ChatInsightCard chart={{ title: chatInsight.question, scopeLabel: "testtest", insight: chatInsight, papers: test.corpus.papers.map((paper) => ({ id: String(paper.id), title: paper.title, year: String(paper.year ?? "Unknown") })) }} />
      </Card>
    ));
  }

  for (const name of ["500 papers", "5,000 papers"]) {
    const big = collection(name);
    const key = name.replace(/[^0-9]/g, "");
    [["themes", view("theme")], ["years", view("year")], ["method-by-theme", view("method", { columns: "theme" })], ["methods-change", view("method", { measure: "change" })]].forEach(([label, query]) =>
      add(`${key}-ask-${label}`, <InsightSpecimen id={`${key}-ask-${label}`} label={`${name} · asked · ${label}`} insight={ask(big.corpus, query as AskQuery)} titles={big.titles} />)
    );
  }

  const long = collection("sixty papers, long names");
  add("long-themes", <InsightSpecimen id="long-themes" label="60 papers, long names · asked · themes" insight={ask(long.corpus, view("theme"))} titles={long.titles} />);
  add("long-grid", <InsightSpecimen id="long-grid" label="60 papers, long names · asked · method by theme" insight={ask(long.corpus, view("method", { columns: "theme" }))} titles={long.titles} />);
  const thai = collection("forty papers, Thai names");
  add("thai-themes", <InsightSpecimen id="thai-themes" label="40 papers, Thai names · asked · themes" insight={ask(thai.corpus, view("theme"))} titles={thai.titles} />);
  const gapped = collection("twelve papers, gapped years");
  add("gapped-years", <InsightSpecimen id="gapped-years" label="12 papers, gapped years · asked · years" insight={ask(gapped.corpus, view("year"))} titles={gapped.titles} />);

  readingCharts().forEach(({ id, label, chart }) =>
    add(`chat-${id}`, (
      <Card id={`chat-${id}`} label={label}>
        <ChatChartCard chart={chart} />
      </Card>
    ))
  );

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-3 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-ink">Chart gallery</h1>
      {specimens}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
