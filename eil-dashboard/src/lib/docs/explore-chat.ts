import type { DocsPageBase } from "./types";

export const chatPage: DocsPageBase = {
  slug: "chat",
  title: "Chat",
  description:
    "Ask questions about your papers and get answers that cite them: scope, attached papers, Chart mode, web search, conversations, daily limits and what is sent to AI models.",
  tags: ["chat", "questions", "citations", "scope", "chart mode", "web search", "limits"],
  popular: true,
  related: ["deep-research", "dashboard", "privacy-and-data"],
  sections: [
    {
      id: "overview",
      title: "What Chat answers",
      body: [
        "**Chat** answers questions from the papers in your repository and says which papers each claim comes from. It opens from **Chat** in the side navigation once a repository is open, and from the **Ask about these papers** box on Home, which carries your question over so you can check it before sending.",
        "How a question is answered depends on what it asks:",
      ],
      figure: {
        shot: "chat",
        alt: "A chat answer about the repository's papers, with numbered citations and source cards under it.",
      },
      table: {
        columns: ["You ask", "What happens"],
        rows: [
          ["How many, which, list, oldest or newest, word counts", "Counted exactly from the stored analysis, without an AI model, and every paper involved is cited."],
          ["A focused question (\"What did the studies find about peer feedback?\")", "The most relevant passages are found and an answer is written from them, then checked against that evidence."],
          ["Summarize each paper", "A paper-by-paper analysis."],
          ["Across the whole repository (\"What are the main themes?\")", "One overview written from every paper in scope. Large ones run in the background."],
          ["A greeting, or something unrelated to the papers", "A short conversational reply, marked **Repository context not used**."],
          ["Citation counts, h-index, impact factor, downloads or predictions", "Refused, with a pointer to Scopus, Web of Science or Google Scholar: the repository holds the papers' text, not bibliographic records."],
        ],
      },
    },
    {
      id: "scope",
      title: "Scope: which papers an answer can use",
      body: [
        "A chat opened inside a repository searches that repository. The line above the text box says what the next message will use, for example `Searching 38 analysed papers in testtest`. Only papers whose analysis succeeded are searched.",
      ],
      steps: [
        "Open the **+** menu under the text box and choose **Repository scope**.",
        "Pick **All repositories** to search every analyzed paper in your account, or one repository by name.",
        "The choice holds for the rest of the conversation until you change it. Each of your messages shows the scope it used; click that label to change the scope again.",
      ],
      callout: {
        tone: "info",
        title: "Opening an older conversation",
        body: "A follow-up uses the scope currently shown above the text box, not the scope the conversation started with. Check the scope line before you send.",
      },
    },
    {
      id: "attached-papers",
      title: "Asking about specific papers",
      body: [
        "To narrow a question to a few papers, open **+** and choose **Attach papers**. The picker lists your 200 most recently updated papers from any repository in your account; search it by name, select papers and choose **Done**. They appear as chips above the text box.",
      ],
      bullets: [
        "Attached papers replace the scope: the message searches only them.",
        "Papers that are not analyzed yet are left out without a message; the answer's scope label counts only the analyzed ones, such as `3 selected papers`.",
        "In a normal answer, attachments apply to one message and are cleared once it is answered. Chart mode and Max effort keep them.",
        "Up to 50 papers are sent with a message.",
        "From the dashboard's Semantic Map, selecting two or more papers and choosing **Compare**, **Ask about papers** or **Explain in chat** opens Chat with them attached. That hand-off expires after 15 minutes.",
        "**+** then **Upload a paper** opens the usual upload window and attaches the new papers; ask once their analysis has finished.",
      ],
    },
    {
      id: "reading-an-answer",
      title: "Reading an answer",
      body: [
        "While it works, Chat names each step, from **Opening your repository** and **Searching your papers** to **Checking it against the evidence** and **Formatting citations**.",
      ],
      bullets: [
        "**Citations** are small numbers after a claim. Hover or focus a number to see the paper's title and year.",
        "**Source cards** under the answer list up to five papers or web pages; **N more** opens the full list. A paper card opens that paper's analysis in the Library.",
        "**The coverage line** says how many papers the answer drew on, for example `Covered all 38 papers in testtest.` or `Based on 6 of 38 papers in testtest.` A focused answer reports the relevant evidence, not a reading of every paper.",
        "**Limitation lines** say when an answer may be incomplete, or could not be checked against the evidence. Read them before relying on the answer.",
        "Answers past about 2,400 characters are folded: **Show more** reveals the rest.",
        "Answers follow the language of the conversation, Thai or English, unless you ask for the other.",
        "Up to three follow-up suggestions appear under the latest answer, built from what it did not cover, such as `Answer this again across every paper, not only the most relevant.`",
      ],
      callout: {
        tone: "success",
        title: "Every claim can be checked",
        body: "An answer is only as good as its evidence. Open the cited paper from its source card and read the passage before quoting a finding.",
      },
    },
    {
      id: "chart-mode",
      title: "Chart mode",
      body: [
        "Open **+** and turn on **Chart mode** to get a chart built from the repository's data. Describe the chart you want in your own words, or send an empty box for the strongest pattern in the papers. Typing chart words in a normal message (in English, or กราฟ and แผนภูมิ in Thai) offers **Use Chart mode**.",
        "The chart is worked out from your question and drawn from the same themes, methods and research areas as the dashboard, with a likely duplicate upload counted once. Its title, numbers and caption are computed, not written by a model. Press a bar or cell to list the papers behind it; each opens in place.",
      ],
      table: {
        columns: ["You can ask for", "For example"],
        rows: [
          ["How the papers divide by theme, method, research area, contribution, kind of study, aim or year", "\"Papers per year\", \"Which methods are used most?\""],
          ["Any two of those crossed", "\"Which methods are used for which themes?\""],
          ["Narrowed to a subject, or two values compared", "\"What do the writing papers set out to produce?\", \"Writing compared with reading\""],
          ["How shares changed from the earlier papers to the later", "\"Is qualitative research becoming more common?\""],
          ["Words per paper, or a term's occurrences by paper", "\"How often does 'feedback' appear in each paper?\""],
        ],
      },
      bullets: [
        "A question the papers' data cannot answer, such as authors, citations or sample sizes, gets a reason and what can be charted instead, not a chart of something else.",
        "Charts cannot be downloaded. For more views, use the [dashboard](/docs/dashboard).",
        "Chart mode goes up to **High** effort: a chart is counted from the papers, not researched, so turning Chart mode on brings **Max** down to High.",
        "Web search does not apply to charts.",
      ],
    },
    {
      id: "web-search",
      title: "Web search",
      body: [
        "Turn on **Web search** from the **+** menu to add current sources from outside your repository. The answer is written from your papers first; a section headed **Web context** follows, with web pages as numbered sources marked **Web source** that open the page.",
        "Every point in that section cites a page the search returned. A point that cites nothing, or gives a number the page does not contain, is left out; when nothing is left, the section is not added and the answer says why. The search runs on the date you ask.",
      ],
      bullets: [
        "Web search runs only while the toggle is on. Writing \"latest\" or \"search online\" in a question does not turn it on.",
        "Small talk is not searched. If the web step fails, you still get the answer from your papers, with a note.",
        "A question with web search on usually runs in the background (see below).",
        "Web pages are chosen by the search provider, not by Papertrend; judge them as you would any search result.",
      ],
    },
    {
      id: "background-answers",
      title: "Long answers in the background",
      body: [
        "Some requests take longer than a page can wait: web search, an overview of the whole repository, analyzing each of more than 80 papers, or a search across every paper in scope. These run as a background job. The conversation shows `Analyzing the selected Papertrend knowledge scope in the background...`, and the answer replaces that message when it is ready.",
      ],
      bullets: [
        "You can leave the conversation and come back; the answer stays attached to it. The page stops checking after about 38 minutes, but the job continues.",
        "If a job fails, the message says so and nothing partial is substituted: send the question again.",
        "Background jobs cannot be stopped from the page.",
      ],
    },
    {
      id: "conversations",
      title: "Conversations",
      body: [
        "Your first message starts a conversation, titled after that message. **Your chats** in the sidebar lists your conversations, newest first and pinned ones on top; **Show older chats** at the end of the list loads more. On a phone or a narrow window, the list button in the header opens them.",
      ],
      bullets: [
        "**Search chats** searches every conversation you have, titles and messages, not only the ones in the sidebar.",
        "Each conversation's **...** menu offers **Pin chat**, **Rename** and **Delete**. Pins are kept in this browser only.",
        "**Delete** is permanent: the messages and any research with them are removed.",
        "Hover one of your messages for **Copy** and **Edit**. Editing re-asks the question and removes every message after it.",
        "**New chat** starts an empty conversation in normal mode.",
        "The **...** menu in the header lists **Files in this conversation**: every source cited so far.",
        "A long conversation opens on its newest messages; **Load earlier messages** at the top brings back older ones.",
        "Under each finished answer, **Copy** and **Download (.md)** save it with its numbered sources. The **...** menu in the header has **Export conversation (.md)** for the whole conversation. Charts are not exported.",
      ],
    },
    {
      id: "models",
      title: "Models",
      body: [
        "Answers are planned, written and checked by **GPT-6 Luna**, named under the text box. Chart mode and Max effort choose their own models.",
      ],
    },
    {
      id: "stop",
      title: "Stopping an answer",
      body: [
        "While an answer is being written, **Send** becomes **Stop**, and pressing Enter in the text box also stops it. Your question stays in the conversation. A Max answer is stopped with **Stop** on its thinking line.",
      ],
    },
    {
      id: "cached-answers",
      title: "Repeated questions",
      body: [
        "When you open a new conversation with exactly the question you asked in the same scope within the last 30 minutes, the earlier answer is reused, with the note `Answered from an earlier identical question in this repository.` Adding or re-analyzing a paper in the scope gives a fresh answer.",
      ],
    },
    {
      id: "limits",
      title: "Daily limits",
      body: [],
      table: {
        columns: ["Limit", "Amount", "Resets"],
        rows: [
          ["Chat tokens", "1,000,000 tokens a day, counted from the answers you receive", "00:00 UTC (07:00 in Thailand)"],
          ["Web searches", "40 a day; each answer with web search on uses one", "Midnight UTC"],
          ["Max effort", "10 a day; starting one counts, planning and retrying do not", "Midnight UTC"],
          ["Message length", "12,000 characters; longer messages are shortened in the middle", "Not applicable"],
        ],
      },
      bullets: [
        "When the token limit is reached, Chat says `Daily chat token limit reached (1,000,000 tokens). Please try again tomorrow.` The answer that crosses the limit still completes.",
        "Background answers count toward the token limit like any other.",
        "Remaining allowance is not shown anywhere yet.",
      ],
    },
    {
      id: "keyboard",
      title: "Keyboard",
      body: [],
      table: {
        columns: ["Key", "Does"],
        rows: [
          ["Enter", "Sends the message; while an answer is being written, stops it"],
          ["Shift + Enter", "A new line"],
          ["Escape", "Closes Search chats and the paper picker"],
          ["/", "Opens workspace search from anywhere outside a text field"],
        ],
      },
    },
    {
      id: "what-is-sent",
      title: "What is sent to AI models",
      body: [
        "Counts, lists, years and word counts are computed without any model. For a written answer, the models receive your question, recent turns of the conversation, a short summary of each paper in scope (title, year, main topics and a brief) and the passages chosen as evidence, never a whole paper. Models are reached through OpenRouter. More in [Privacy and data](/docs/privacy-and-data).",
      ],
    },
    {
      id: "empty-chat",
      title: "Starting points",
      body: [
        "A new conversation opens with **Ask your papers**, three example questions built from your repository, what Chat can do (count and list, answer from the text, compare across papers, chart what it counts, answer in Thai or English) and **What it cannot answer**: citation counts and impact, anything in the future, papers outside the repository, and the full text of a paper it could not read.",
      ],
    },
    {
      id: "messages",
      title: "Messages you may see",
      body: [],
      table: {
        columns: ["Message", "Meaning and what to do"],
        rows: [
          ["No completed, analyzed papers were found in <scope>.", "Nothing in scope has finished analysis. Upload papers or wait for them, or widen the scope."],
          ["...no topic rows are available in <scope> yet.", "Papers exist but their topic step failed. Analyze them again from the Library."],
          ["This answer took longer than the public gateway allows.", "The answer may still arrive. Reopen the conversation in a minute before asking again."],
          ["I could not finish this answer.", "Evidence was found but the answer could not be written and checked. The papers found are listed; ask again."],
          ["This chat request exceeded its safe context limit.", "The page is out of date or a message is too long. Refresh and try again."],
          ["Daily AI usage limit reached.", "The day's 10 Max effort answers are used."],
        ],
      },
    },
  ],
};

export const deepResearchPage: DocsPageBase = {
  // The address stays "deep-research": Max effort is what deep research became (2026-10-10).
  slug: "deep-research",
  title: "Thinking effort",
  description:
    "How hard an answer works, from Low to Max. Max reads the full text of every paper in scope, searches the web only where the papers cannot answer, and checks every claim against its source.",
  tags: ["thinking effort", "max", "deep research", "low", "high", "sources"],
  related: ["chat", "dashboard", "troubleshooting"],
  sections: [
    {
      id: "when-to-use",
      title: "Choosing an effort",
      body: [
        "The **thinking effort** under the text box sets how hard the next answer works. Open it and slide from **Low** to **Max**; your choice is remembered on this browser, and one conversation can mix efforts.",
      ],
      table: {
        columns: ["Effort", "What it does", "Use it for"],
        rows: [
          ["Low", "Reads the few papers that matter most and thinks briefly", "A quick fact or a follow-up"],
          ["Medium", "The usual answer: reads the papers that bear on the question", "Most questions"],
          ["High", "Reads more widely, thinks longer, and checks every claim against the papers", "A question that spans several papers"],
          ["Max", "Splits the question into up to five parts, reads every paper in full for each, and checks every claim. About a minute", "A broad question, such as \"How is dynamic assessment used to support Thai EFL learners, and what do the studies find?\""],
        ],
      },
    },
    {
      id: "plan-and-start",
      title: "Max, step by step",
      steps: [
        "Slide the thinking effort to **Max**, then write your question and send it.",
        "It starts at once: first it splits the question into the parts it will look into, and for each whether it uses your papers, the web, or both.",
        "While it works, one line under your question says what it is doing and for how long. **Show steps** lists the parts; **Stop** stops it, and **Resume** carries on from where it stopped.",
      ],
      body: [],
      callout: {
        tone: "info",
        title: "Ten a day",
        body: "You have 10 Max answers a day, and each question asked at **Max** uses one. Retrying one that failed, or resuming one you stopped, uses none. Chart mode goes up to **High**: a chart is counted from the papers, not researched.",
      },
    },
    {
      id: "while-it-runs",
      title: "While it thinks",
      body: [
        "Each part shows what it is doing and then what it found, such as `Found 6 passages in 4 papers.` or `Not found in the 39 papers searched.` Then the answer is written, and then every claim is checked.",
      ],
      bullets: [
        "It uses the papers that have finished analysis; papers still being analysed are named in the answer's last section rather than waited for.",
        "You can leave and come back: it carries on without the page, and picks up where it stopped if it is interrupted.",
      ],
    },
    {
      id: "how-it-checks",
      title: "How Max checks itself",
      body: ["Every Max answer has the same limits, and the same checks, so it can be relied on as far as its sources go."],
      table: {
        columns: ["Step", "What happens"],
        rows: [
          ["Search", "The full text of every paper in scope, for each part of the question, with reference lists left out"],
          ["Evidence", "Only passages a finding actually rests on are kept and cited; at most 8 per part"],
          ["Web", "Only for parts the papers cannot answer, at most 4 searches, each page cited by its address"],
          ["Numbers", "Every number in the answer must appear in the passage it cites"],
          ["Claims", "A second model checks each sentence against its source; what the source does not support is corrected or removed"],
        ],
      },
      bullets: [
        "When the papers do not cover something, the answer says the papers searched do not address it; it does not call it a gap in the literature.",
        "Text inside papers and web pages is treated as evidence, never as instructions.",
        "The models are chosen for you: GPT-6 Luna plans, reads and writes; Gemini 3.8 Flash checks the claims, so the model that wrote a sentence is not the one that judges it.",
      ],
    },
    {
      id: "the-report",
      title: "Reading a Max answer",
      body: [
        "The answer appears in the conversation like any other, in the language you asked in, with its citations numbered: a paper opens in place on its evidence, and a web page opens its address.",
        "A line above it says how long it thought, how many parts and papers it read and how many claims it checked; click it to see the steps. **Copy** and **Download (.md)** give you the text with a numbered source list.",
      ],
      callout: {
        tone: "info",
        title: "Read the sources before relying on it",
        body: "An answer is only as complete as the papers in scope. Use it to find what the papers say and where, then read the cited passages before drawing conclusions.",
      },
    },
    {
      id: "limits",
      title: "Limits and good to know",
      bullets: [
        "Every effort counts toward the daily chat token limit; High uses more of it than Medium, and each Max answer also counts toward the 10 a day.",
        "Each new question at Max gets its own parts and answer; earlier answers stay in the conversation.",
        "Deleting the conversation deletes its answers and their steps.",
      ],
      body: [],
    },
  ],
};
