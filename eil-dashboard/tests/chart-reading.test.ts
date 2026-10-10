/*
 * Chart mode reading the papers (chart-reading.ts): a value is charted only
 * when the sentence it comes from is in the paper and the number is in that
 * sentence, and the chart and the reply's numbers are computed, not written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkable,
  numberInQuote,
  numbersIn,
  parseReadPlan,
  planChart,
  quoteInText,
  readFigures,
  readValues,
  valueChart,
  wordsOf,
  type ChartPaper,
  type ReadPlan,
  type ValueReading,
} from "../src/lib/chart-reading";
import type { ChatCompletionResult, ChatMessage } from "../src/lib/openai";

function paper(id: string, year: string, methods: string, results = "Scores rose after the course."): ChartPaper {
  return {
    paperId: id,
    title: `Study ${id} of English pronunciation`,
    year,
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content: [
      `Study ${id} of English pronunciation`,
      "",
      "Abstract",
      "We studied how Thai learners pronounce English plosives.",
      "",
      "Methods",
      methods,
      "",
      "Results",
      results,
      "",
      "Conclusion",
      "Teachers should model aspiration.",
    ].join("\n"),
    contentSource: "full_text",
  };
}

const PLAN: ReadPlan = {
  kind: "values",
  title: "Participants in each study",
  chart: "bar",
  field: "total number of participants",
  valueType: "number",
  unit: "participants",
  groupBy: "paper",
  series: [],
  terms: [],
  search: ["participants", "students"],
};

type Reply = (messages: ChatMessage[], task: string) => unknown;

function model(reply: Reply) {
  const calls: Array<{ task: string; messages: ChatMessage[] }> = [];
  const complete = async (messages: ChatMessage[], _temperature?: number, _model?: string, task?: string): Promise<ChatCompletionResult | null> => {
    calls.push({ task: task ?? "", messages });
    const answer = reply(messages, task ?? "");
    if (answer === null) return null;
    return { content: typeof answer === "string" ? answer : JSON.stringify(answer), annotations: [], toolCalls: [] };
  };
  return { complete, calls };
}

test("a quote is found when it is in the paper, whatever its punctuation or case", () => {
  const text = checkable("Methods\nForty-nine seventh-grade students read a word list aloud. Their speech was recorded.");
  assert.equal(quoteInText("forty-nine Seventh-grade students read a word list aloud", text), true);
  assert.equal(quoteInText("Forty-nine seventh-grade students … was recorded.", text), true, "parts cut with an ellipsis are found one by one");
  assert.equal(quoteInText("Fifty university students read a word list aloud.", text), false, "a sentence the paper does not contain");
  assert.equal(quoteInText("read a", text), false, "too short to show anything");
});

test("a number counts only where the paper prints it beside the same word", () => {
  const text = checkable("Forty-nine seventh-grade students took part. A survey of 1,200 respondents followed, in two groups of 24 and 25.");
  assert.equal(numberInQuote(49, "Forty-nine seventh-grade students took part.", text), true, "a number in words");
  assert.equal(numberInQuote(1200, "A survey of 1,200 respondents followed", text), true, "a number with a thousands comma");
  assert.equal(numberInQuote(48, "Forty-nine seventh-grade students took part.", text), false, "a number not in the sentence");
  assert.equal(numberInQuote(49, "49 students took part.", text), false, "a number the paper writes beside other words");
  assert.deepEqual(numbersIn(wordsOf("one and two")).map((token) => token.value), [1, 2], "'and' joins only after a hundred or a thousand");
  assert.deepEqual(numbersIn(wordsOf("one hundred and twenty")).map((token) => token.value), [120]);
});

test("each paper's value is kept only when it checks out against the paper", async () => {
  const papers = [
    paper("a", "2019", "Forty-nine seventh-grade students read a word list aloud."),
    paper("b", "2021", "Participants were two groups of 24 and 25 undergraduates."),
    paper("c", "2022", "Thirty teachers were interviewed about their practice."),
    paper("d", "2023", "The corpus comprised 300 essays."),
  ];
  const { complete, calls } = model(() => ({
    items: [
      { paperId: "a", reported: true, number: 49, quote: "Forty-nine seventh-grade students read a word list aloud.", note: "" },
      { paperId: "b", reported: true, number: 49, parts: [24, 25], quote: "Participants were two groups of 24 and 25 undergraduates.", note: "" },
      // Made up: the paper says thirty.
      { paperId: "c", reported: true, number: 40, quote: "Forty teachers were interviewed about their practice.", note: "" },
      { paperId: "d", reported: false, quote: "", note: "" },
    ],
  }));
  const reading = await readValues({ papers, plan: PLAN, question: "How many participants did each study have?", effort: "medium", complete });
  assert.equal(calls.length, 1, "four short papers are read in one call");
  assert.equal(calls[0].task, "CHAT_CHART_EXTRACT");
  assert.match(calls[0].messages[1].content as string, /Forty-nine seventh-grade students/, "the paper's text is read, not its stored summary");
  assert.deepEqual(reading.found.map((value) => [value.paper.paperId, value.number]), [["a", 49], ["b", 49]]);
  assert.equal(reading.found[1].note, "the total of 24 and 25", "a total given in parts says so");
  assert.deepEqual(reading.unverified.map((entry) => entry.paperId), ["c"]);
  assert.deepEqual(reading.notStated.map((entry) => entry.paperId), ["d"]);

  const chart = valueChart(reading, PLAN);
  assert.ok(chart.chart);
  assert.deepEqual(chart.chart.yKeys, ["Participants"]);
  assert.equal(chart.chart.data.length, 2);
  assert.match(chart.lead, /\*\*2 of 4 papers\*\* state total number of participants/);
  assert.match(chart.lead, /median of \*\*49\*\* participants/);
  assert.deepEqual(chart.sources.map((source) => source.value), ["49 participants", "49 participants"]);
  assert.ok(chart.limitations.some((line) => /1 paper does not state total number of participants in the text read: “Study d/.test(line)));
  assert.ok(chart.limitations.some((line) => /1 value could not be found word for word in its paper and was left out/.test(line)));
});

test("answers named in many ways are counted in shared groups, and a null field costs nothing", async () => {
  const instruments = [
    "Semi-structured interview", "Interviews", "Focus group interview", "Questionnaire", "Survey questionnaire",
    "Classroom observation", "Observation checklist", "Vocabulary Size Test", "Cloze test", "Reading span task",
  ];
  const papers = instruments.map((name, index) => paper(`p${index}`, "2020", `Data were collected with a ${name.toLowerCase()} designed for this study.`));
  const { complete, calls } = model((messages) => {
    const system = String(messages[0].content);
    if (/You group the answers/.test(system)) {
      return {
        groups: [
          { label: "Interview", members: ["Semi-structured interview (1)", "Interviews", "Focus group interview"] },
          { label: "Questionnaire", members: ["Questionnaire", "Survey questionnaire"] },
          { label: "Observation", members: ["Classroom observation", "Observation checklist"] },
          { label: "Test", members: ["Vocabulary Size Test", "Cloze test", "A test no paper named"] },
        ],
      };
    }
    const asked = JSON.parse(String(messages[1].content)) as { papers: Array<{ paperId: string }> };
    return {
      items: asked.papers.map(({ paperId }) => {
        const name = instruments[Number(paperId.slice(1))];
        // The model writes null for what does not apply.
        return { paperId, reported: true, number: null, parts: null, values: [name], quote: `Data were collected with a ${name.toLowerCase()} designed for this study.`, note: null };
      }),
    };
  });
  const plan: ReadPlan = { ...PLAN, valueType: "category", field: "data collection instruments", unit: "" };
  const reading = await readValues({ papers, plan, question: "Which instruments do the studies use?", effort: "medium", complete });
  assert.equal(calls.filter((call) => /You group the answers/.test(String(call.messages[0].content))).length, 1, "one call groups the names");
  assert.equal(reading.found.length, 10, "every paper read, nulls and all");
  const chart = valueChart(reading, plan);
  assert.deepEqual(chart.chart?.data, [
    { label: "Interview", Papers: 3 },
    { label: "Observation", Papers: 2 },
    { label: "Questionnaire", Papers: 2 },
    { label: "Test", Papers: 2 },
    { label: "Reading span task", Papers: 1 },
  ], "an answer the grouping left out keeps the paper's own word");
  assert.equal(chart.sources.find((source) => source.paperId === "p0")?.value, "Semi-structured interview", "the source shows what the paper itself says");
});

test("numbers by year are drawn as the median of each year", () => {
  const found = [
    { year: "2019", number: 20 },
    { year: "2019", number: 40 },
    { year: "2023", number: 100 },
    { year: "Unknown", number: 5 },
  ].map((entry, index) => ({ paper: paper(String(index), entry.year, ""), number: entry.number, values: [], quote: "q", note: "" }));
  const reading: ValueReading = { found, notStated: [], unverified: [], failed: [], readInPart: 0, skipped: 0 };
  const chart = valueChart(reading, { ...PLAN, groupBy: "year", chart: "line" });
  assert.equal(chart.chart?.chartType, "line");
  assert.deepEqual(chart.chart?.data, [
    { label: "2019", "Median participants": 30 },
    { label: "2023", "Median participants": 100 },
  ]);
  assert.match(chart.lead, /Papers from 2019 \(2\) have a median of \*\*30\*\* participants; papers from 2023 \(1\), \*\*100\*\* participants\. With this few papers, one study moves a median\./);
  assert.ok(chart.limitations.some((line) => /1 paper without a year is left out/.test(line)));
});

test("names are counted by paper, most common first", () => {
  const values = [["Thailand"], ["thailand", "Japan"], ["Japan"], ["Thailand"]];
  const found = values.map((names, index) => ({ paper: paper(String(index), "2020", ""), number: null, values: names, quote: "q", note: "" }));
  const chart = valueChart({ found, notStated: [], unverified: [], failed: [], readInPart: 0, skipped: 0 }, { ...PLAN, valueType: "category", field: "country where the study was conducted", unit: "" });
  assert.deepEqual(chart.chart?.data, [
    { label: "Thailand", Papers: 3 },
    { label: "Japan", Papers: 2 },
  ]);
  assert.match(chart.lead, /\*\*Thailand\*\* is the most common \(3 papers\), then Japan \(2\)/);
});

test("a paper's figures are kept only when every number is printed in it", async () => {
  const study = paper("t", "2022", "Twenty learners took a pre-test and a post-test.", "Table 2. Control 12.4 15.1; Experimental 12.9 18.6.");
  const { complete } = model(() => ({
    series: ["Pre-test", "Post-test"],
    rows: [
      { paperId: "t", label: "Control", values: [12.4, 15.1], quote: "Control 12.4 15.1" },
      { paperId: "t", label: "Experimental", values: [12.9, 18.6], quote: "Experimental 12.9 18.6" },
      { paperId: "t", label: "Gain", values: [null, 5.7], quote: "" },
    ],
  }));
  const plan: ReadPlan = { ...PLAN, kind: "paper_table", field: "mean pre-test and post-test scores by group", series: ["Pre-test", "Post-test"], unit: "" };
  const chart = await readFigures({ papers: [study], plan, question: "Chart the scores", effort: "medium", complete });
  assert.deepEqual(chart.chart?.data, [
    { label: "Control", "Pre-test": 12.4, "Post-test": 15.1 },
    { label: "Experimental", "Pre-test": 12.9, "Post-test": 18.6 },
  ]);
  assert.ok(chart.limitations.some((line) => /1 row was left out because a number in it is not printed in the paper/.test(line)), "a computed gain is not charted");
  assert.match(chart.lead, /the highest Pre-test is \*\*12\.9\*\* \(Experimental\)\.$/, "the first series is highlighted, not a second one");
});

test("the planner's choice is read from a tool call or from the message, and a view needs enough papers", async () => {
  const read = { kind: "values", title: "Participants", chart: "bar", field: "total number of participants", value_type: "number", unit: "participants", group_by: "paper", series: [], terms: [], search: [] };
  const papers = [{ title: "A", year: "2020" }];
  const viaContent = await planChart({ question: "How many participants?", scopeLabel: "Test", papers, vocabulary: null, complete: model(() => read).complete });
  assert.equal(viaContent?.tool, "read_papers");
  const view = { answerable: true, title: "Methods", measure: "papers", rows: "method", columns: "none", focus_dimension: "none", focus_values: [], about_values: [] };
  const noViews = await planChart({ question: "Which methods?", scopeLabel: "Test", papers, vocabulary: null, complete: model(() => view).complete });
  assert.equal(noViews, null, "a dashboard view is not taken for fewer papers than it needs");
  const vocabulary = { theme: [], method: ["Survey"], category: [], contribution: [], study_type: [], aim: [], year: [] };
  const withViews = await planChart({ question: "Which methods?", scopeLabel: "Test", papers, vocabulary, complete: model(() => ({ tool: "build_view", arguments: view })).complete });
  assert.equal(withViews?.tool, "build_view");
  assert.equal(parseReadPlan({ ...read, field: "" }), null, "a value with no field is not a plan");
  assert.equal(parseReadPlan({ ...read, kind: "terms", terms: [] }), null, "a word count with no words is not a plan");
});
