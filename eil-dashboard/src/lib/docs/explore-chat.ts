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
        "In a normal answer, attachments apply to one message and are cleared once it is answered. Chart mode and Deep research keep them.",
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
        "Open **+** and turn on **Chart mode** to get a chart built from the repository's data. Describe the chart, or send an empty box for the most useful one. Typing chart words in a normal message (in English, or กราฟ and แผนภูมิ in Thai) offers **Use Chart mode**.",
      ],
      table: {
        columns: ["Chart", "Shows"],
        rows: [
          ["Top repository topics", "The ten largest topics, as bars, a pie or a table"],
          ["Repository topic coverage by year", "The five largest topics as lines over the years"],
          ["Words per paper, or a term's occurrences by paper", "Exact counts from each paper's text"],
        ],
      },
      bullets: [
        "Charts cannot be downloaded. For more views, use the [dashboard](/docs/dashboard).",
        "Chart mode and Deep research cannot be on together; turning one on turns the other off.",
        "Web search does not apply to charts.",
      ],
    },
    {
      id: "web-search",
      title: "Web search",
      body: [
        "Turn on **Web search** from the **+** menu to add current sources from outside your repository. The answer is written from your papers first; a section headed **Web context** follows, with web pages as source cards marked **Web source**.",
      ],
      bullets: [
        "Web search runs only while the toggle is on. Writing \"latest\" or \"search online\" in a question does not turn it on.",
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
        "There is no export yet: answers, charts and reports cannot be downloaded or copied with one click.",
      ],
    },
    {
      id: "models",
      title: "Models",
      body: [
        "The **Model** picker under the text box chooses who writes the answer: **GPT-5.6 Luna** (the default) or **Gemini 3.7 Flash**. The choice is remembered in this browser. Planning the search and judging whether the evidence is enough always use Gemini 3.7 Flash, whichever you pick. Chart mode and Deep research choose their own models, so the picker is hidden there.",
      ],
    },
    {
      id: "stop",
      title: "Stopping an answer",
      body: [
        "While an answer is being written, **Send** becomes **Stop**, and pressing Enter in the text box also stops it. Your question stays in the conversation. A deep research run cannot be stopped once started.",
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
          ["Deep research", "10 requests a day; a plan and its start count as one each", "Midnight UTC"],
          ["Message length", "12,000 characters; longer messages are shortened in the middle", "Not applicable"],
        ],
      },
      bullets: [
        "When the token limit is reached, Chat says `Daily chat token limit reached (1,000,000 tokens). Please try again tomorrow.` The answer that crosses the limit still completes.",
        "Background answers are not counted toward the token limit.",
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
          ["Daily AI usage limit reached.", "The day's 10 deep research requests are used."],
        ],
      },
    },
  ],
};

export const deepResearchPage: DocsPageBase = {
  slug: "deep-research",
  title: "Deep research",
  description:
    "A longer, planned investigation that reads across your papers, optionally searches the web, and writes a cited report. How to plan, start and read one, and its fixed budget.",
  tags: ["deep research", "report", "plan", "sources", "agent"],
  related: ["chat", "dashboard", "troubleshooting"],
  sections: [
    {
      id: "when-to-use",
      title: "When to use it",
      body: [
        "A normal answer reads the passages most relevant to one question. **Deep research** takes a broader question, plans how to investigate it, reads several papers in turn, looks for what is missing, checks its findings and writes a report with a numbered list of sources. It takes minutes rather than seconds.",
        "Use it for questions such as \"How has research on teacher feedback in Thai universities changed, and where are the gaps?\". For a fact, a count or one paper's method, a normal answer is faster.",
      ],
    },
    {
      id: "plan-and-start",
      title: "Plan, then start",
      steps: [
        "In Chat, open **+** and turn on **Deep research**.",
        "Write your question and send it. You get a **plan**, not yet a report: the steps the research will take, and what the research agent chose for itself: where it looks (**This repository**, **All your repositories** or the attached papers), whether it searches the web, and whether it builds charts.",
        "Read the plan. **Edit** puts your question back in the text box to change it, **Cancel** opens a fresh research chat, and **Start** begins the run.",
      ],
      body: [],
      callout: {
        tone: "warning",
        title: "Each plan and each start counts",
        body: "You have 10 deep research requests a day. Sending a question for a plan uses one, and Start uses another, so a full run uses two. Editing and re-planning uses one more each time.",
      },
    },
    {
      id: "while-it-runs",
      title: "While it runs",
      body: [
        "The status next to the title moves through **Planned**, **Queued**, **Waiting on analysis**, **Researching**, and **Completed** (or **Completed (partial)** or **Failed**). A bar shows the steps done, such as `3/7 steps`, and each step lists the sources it used and the evidence it found, with a relevance score.",
      ],
      bullets: [
        "If papers in scope are still being analyzed, the run waits for them: `Analyzing N pending file(s) before research continues.`",
        "The page checks for progress every few seconds; you can leave and come back to the conversation.",
        "A started run cannot be stopped.",
      ],
    },
    {
      id: "the-budget",
      title: "The fixed budget",
      body: ["Every run has the same limits, so a run cannot grow without bound. They cannot be changed."],
      table: {
        columns: ["Resource", "Limit"],
        rows: [
          ["Papers read from your library", "8"],
          ["Web searches", "5, only when the agent decides the web is needed"],
          ["Sources in the report", "12"],
          ["Rounds looking for gaps", "1"],
          ["Rounds checking the findings", "1"],
        ],
      },
      bullets: [
        "The research agent decides the scope, web search and charts from your question; there are no switches to set. It widens the scope itself, for example to your whole account, when a question asks about a whole field.",
        "It searches the web only when current or outside sources would change the answer, and never more than the budget allows. The plan says so before you start.",
        "The models are chosen for you: Gemini 3.1 Flash-Lite plans, reads and writes; web searches use Gemini 3.7 Flash.",
      ],
    },
    {
      id: "the-report",
      title: "Reading the report",
      body: [
        "When the run completes, a **Deep research report** card appears with its first sections. **Full view** (or **Expand**) opens the whole report over the page, with a numbered **Sources** list at the end. **Close** returns to the conversation.",
        "Summary tiles show how many **Sources** were used, how many came from your **Library**, how much **Evidence** was collected and the run's **Completion**. **Completed (partial)** means some steps did not finish; the report says which sections are missing.",
      ],
      callout: {
        tone: "info",
        title: "Treat it as a draft review",
        body: "Eight papers is a sample, not the whole repository. Use the report to find directions and sources, then read the cited papers before drawing conclusions.",
      },
    },
    {
      id: "limits",
      title: "Limits and good to know",
      bullets: [
        "Deep research runs are not counted toward the daily chat token limit, only toward the 10 daily requests.",
        "Only the first question of a research conversation is kept as a message; later re-plans replace the plan.",
        "Reports cannot be downloaded yet.",
        "Deleting the conversation deletes its research.",
      ],
      body: [],
    },
  ],
};
