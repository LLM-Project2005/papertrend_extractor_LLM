# Professor's feedback round (2026-10-24): analysis and plan

The professor reviewed the production site and asked for changes in six areas:
- the chat's usage panel,
- the paper window's Evidence, Keywords and Topics tabs,
- theme colours,
- where the theme charts live, and the dashboard's overall layout,
- the semantic map,
- the second chat model.

This file records what was found on production (web 00099-bum, repository testtest, 41 papers) and what will change. No model is called by any of it.

## 1. Chat: today's AI allowance

**Now.** The usage panel holds the following:
- a chat allowance bar, with a line counting Luna tokens;
- "Enough for about … answers" for each model;
- three more bars: Questions, Max effort answers and Web searches;
- for admins, the whole site's spend this month;
- a reset note.

**Change.** The panel shows its title, one bar with "N% left", and one line saying when it resets. An account with no limit shows a single line saying so.
- The other three limits are still enforced on the server. A request that hits one gets that limit's own message, as it does today.
- The site's monthly spend stays on the admin page, which already has it.

## 2. Chat: remove GPT-6.1 Sol

Sol is removed from the model list (`CHAT_MODELS`).
- A saved Sol choice, a request that names Sol, or a Max plan saved with Sol as its writer before the change is answered by GPT-6 Luna (`resolveChatModel`, `sessionWriterModel`).
- The composer's control returns to how it was before Sol: GPT-6 Luna is the only model in its list, and Ask again shows no model choice.
- Sol's row stays in the price table (`model-prices.ts`), so the Sol use already recorded is still counted at its price.
- docs/39 gets a note that Sol was withdrawn on 2026-10-24 because it used too much of the allowance.

## 3. Paper window: scanned PDFs on the Evidence tab

**Now.** A scanned PDF has no text layer, so no passage can be found on it. The tab says "None of this paper's evidence is in the PDF's text" and lists the passages under a closed heading. Nothing says why.

**How a scan is recognised.** Two checks are used, in this order.

1. **What the analysis recorded.** Every analysis stores `analysis_quality.extraction_method`:

   | Value | Meaning |
   |---|---|
   | `vision_fallback` | The whole PDF had no usable text, so every page was read with OCR. |
   | `fitz_text+vision_pages` | A typed PDF with some scanned pages. Only those pages were read with OCR. |
   | `fitz_text` | A typed PDF with a text layer. |

   The record also stores `translation_strategy`. A Thai paper analysed in English has English evidence, so that evidence can't be matched to the Thai PDF.

2. **The PDF itself.** This covers papers whose record says `unknown`. The viewer already extracts every page's text in order to place the marks. A page with almost no text (under 20 characters) is an image page. If every page is like that, the PDF is a scan; if only some are, it is partly scanned.

**Change.**
- **In the paper window's header**, a chip beside "Analysis ready" says "Scanned PDF" or "Partly scanned". A typed PDF gets no chip.
- **On the Evidence tab**, a notice above the PDF says which case it is and why marks are missing. The passages are listed open below it, not folded away:

  | Case | Notice |
  |---|---|
  | Scanned | "This PDF is a scanned image. Its pages are pictures of text, so the evidence can't be highlighted on them. Papertrend read the pages with OCR; the 12 passages it found are listed below." |
  | Partly scanned | Marks what it can, then: "Pages 1 and 2 are scanned images, so passages on them can't be highlighted." |
  | Analysed in translation | "This paper was analysed in an English translation, so its evidence is in English and can't be matched to the Thai PDF." |
  | Typed, passage not found | The current wording. |

## 4. Paper window: the Keywords and Topics tabs

**Are they the same? Mostly, yes.** Both tabs come from the same rows, one per keyword, each holding its topic, how often it appears, and one evidence sentence.
- **Keywords** lists those rows one by one, with the topic in small capitals.
- **Topics** groups the same keywords under their topic and repeats the first keyword's sentence.

So the same names and the same sentences appear twice, in two layouts. Both are plain grey cards of different heights, so neither is easy to scan.

**Change (recommended): one "Topics" tab in place of both.**
- **Cards.** There is one card per topic, largest first. Each card's left edge, and the dot on its theme chip, show the topic's repository theme colour (section 5).
- **Theme chip.** The chip names the theme the topic belongs to, for example "Academic and Second Language Writing · 7 papers", or says "Only in this paper".
- **Keyword rows.** Inside each card, the keywords sit in aligned columns: keyword, mentions (right-aligned, with a small bar), and the evidence sentence clamped to two lines (click to expand). A "Show in PDF" button opens the Evidence tab on that passage.
- **Facets.** Facets move to a compact "Also found" list at the end of the tab.
- **Tabs.** The window's tabs become Overview, Topics, Evidence and Preview. Old links to `paperTab=keywords` open Topics.
- **Overview.** The "Topical coverage" chips and the "Grounded keywords" list get the same theme dots.

## 5. Theme colours: one meaning, everywhere

**What's wrong now.** The same colour means different things on different charts:
- **Blue** means the theme "Academic and Second Language Writing" in Themes by year, the 2011–2021 period in Gaining and losing ground, the research area English Language Instruction, and every bar in Keywords used by the most papers.
- **Orange** means a theme, the 2022–2025 period and a research area.
- **Colour by position.** Colours are handed out by a theme's place in the list each chart draws, so a theme can change colour when a filter changes the list.
- **Repeats.** There are only eight colours, so the 30-theme treemap repeats them.

**Why not a different colour for every theme.** Testtest has 84 themes; 41 of them belong to a single paper, and 43 are shared by two or more. The eye can tell about eight chart colours apart. Past that, colours start to look alike, so a reader can no longer match a colour to its theme and the colour stops meaning anything.

Random colours on each visit have the same problem, and one more: a theme would change colour between visits. That is why the site keeps eight colours, checked for colour blindness and for contrast in light and dark mode (`chart-palette.ts`).

**The rule (recommended).**
1. **Eight fixed colours.** The eight themes with the most papers in the whole repository each get one of the eight chart colours, in order, and keep it. In testtest the 8 largest themes cover 29 of the 41 papers. "Academic and Second Language Writing" is the same blue in every chart, on every filter, and in the paper window.
2. **Every other theme is grey.** It is named by its label or legend entry, and its full name appears on hover. A grey theme is never given a colour that belongs to another theme.
3. **Filters don't repaint.** Filtering by year, research area or folder never changes a theme's colour. Colours are worked out from the whole repository, not from what is on screen.
4. **Keywords take their theme's colour.** A keyword bar uses the colour of the theme most of its papers file it under.
5. **Periods are grey and coloured.** In gaining and losing comparisons, the earlier period is grey and the later period is the theme's colour, so period comparisons never use other themes' colours.
6. **Research areas keep their own colours.** These match the semantic map. No chart mixes research-area colours with theme colours. "Top topics per research area" becomes "Top themes per research area": the bars take theme colours, and each panel's title has its area's dot.

**Alternative, if the professor wants more colours.** Sixteen identities, made from the eight colours in a dark and a light shade. The two shades of one colour are easy to confuse, so this needs a legend on every chart.

**How it's built.**
- `src/lib/theme-colors.ts` holds `themeColorMap(trends)`. It ranks themes by distinct papers, breaks ties by name, and returns each theme's colour or grey.
- The dashboard data response carries the map for the repository.
- The paper window's analysis response carries the theme and colour for each of the paper's topics. That reading uses the stored theme grouping (`loadThemeStore`) and calls no model.

## 6. Dashboard: the theme charts move, and the layout is tidied

### Findings on the current tabs

| # | Where | Problem |
|---|---|---|
| F1 | Every tab | Colour means several things (section 5). |
| F2 | Area Analysis "Themes by year"; Keyword Explorer "Themes across years" and "Compare themes over time" | Three charts show the same numbers (papers per theme per year), on two tabs, as bars, a grid and lines. |
| F3 | Keyword Explorer | Four of its five charts are about themes, not keywords. |
| F4 | Keyword bars, treemap, Themes-by-year legend | Names are cut short ("English as an international lan…", "Formative and Classroom Assessment Prac…"). |
| F5 | Themes across years | Most cells print a 0, so the counts that matter are hard to find. |
| F6 | Research area co-occurrence | The column headings don't line up with the cells, which float in wide columns. |
| F7 | Top topics per research area | Names wrap to three lines in a narrow column. An empty "Other / Unclassified" panel takes a quarter of the width. |
| F8 | All cards | "Download CSV" sits under the title on some cards and at the bottom on others. |
| F9 | Gaining and losing ground | The two halves have different label widths. Bars use blue and orange for the two periods. |

### New layout

**Area Analysis**
1. **Themes** (was "Trend analysis")
   - The summary sentence, as now.
   - **Theme sizes:** the treemap, moved here. The top 8 themes are coloured and the rest grey. Clicking a theme lists its papers.
   - **Themes over time:** one card in place of the three charts in F2.
     - A switch picks Bars, Lines or Grid. They share one theme picker (chips in theme colours), which starts on the 5 largest themes.
     - The grid leaves zero cells blank.
   - **Gaining and losing ground:** grey for earlier and the theme colour for later. Both halves use the same label width.
   - **Themes and what they gather:** the table, moved here. Each theme gets its colour dot, and its keyword chips are tinted.
2. **Research areas**
   - **Papers per research area per year:** unchanged.
   - **Research area co-occurrence:** a square grid with aligned headings, equal cells and blank zeros.
   - **Top themes per research area:** empty panels are hidden, names get a wider column of at most two lines, and bars take theme colours.

**Keyword Explorer** keeps what is about keywords:
- the concept search;
- "Keywords used by the most papers", with bars in each keyword's theme colour, full names over two lines, and a theme legend.

**Semantic Map and Adaptive** move nothing. Adaptive already uses grey and blue for its periods.

**Every card** gets the same footer: "Show the values" on the left and "Download CSV" on the right. Full names appear on hover wherever a label has to be shortened.

The in-app docs pages for the dashboard (`src/lib/docs/explore-dashboard.ts`) are updated to the new places.

## 7. Semantic map

### Download

"Papers CSV" and "Connections CSV" become one **Download PNG** button. It saves the map as it is laid out now, in either layout, at twice screen resolution, on a white background. The image includes the title, the colour key and the date.

The image is drawn from the map's own data (positions, links, colours) onto a canvas. It is not a screenshot of the page, so it works the same in both layouts and needs no new library.

### Scrolling over the map

**Cause.** The free graph listens for the mouse wheel through React, which registers wheel listeners as passive. The graph's call to cancel the page scroll is therefore ignored, so the page scrolls while the graph zooms. The fixed projection (React Flow) already cancels it.

**Change.** The free graph attaches its own wheel listener that is allowed to cancel the scroll. Over the map, the wheel always zooms, including at the zoom limits. Outside the map, the page scrolls.

### Side panel

**Now.** The panel holds five cards, and four more blocks of text sit around the map. Some of it is said twice:
- **The layout explanation** appears in the Display card and again in a box on the map.
- **Colour groups** are listed in both "Neighborhoods" and "Legend". Neighborhoods mostly says it is not in use: "These papers form one neighborhood, so the map is coloured by research area instead."
- **The relationship count** appears in the header ("46 visible relationships") and again in the panel ("Retained relationships 46").
- **"How this map is built"** is repeated by a paragraph under the map.
- **A badge** in the Display card names the layout that the toggle beside it already shows.
- **The note about excluded papers** takes a full-width row.

**New arrangement.**
- **Header:** "Semantic map", then "41 papers · 46 links". A muted note says when failed papers are left out ("15 papers that failed analysis aren't on the map"). Regenerate stays.
- **Toolbar on the map:** search, layout (Fixed projection | Free graph), colour by, the Papers filter and Download PNG. A single hint sits in the map's corner: "Scroll to zoom · drag to move".
- **Side panel**, top to bottom:
  1. **Selection.** The selected paper, link or set of papers, with Compare and Ask (moved from the header). With nothing selected, one line says how to select.
  2. **Colour key.** The colours for the current "colour by", with counts. Clicking one focuses it. This replaces both Neighborhoods and Legend.
  3. **Show.** Links and Paper labels. In the free graph, it also has Pause and Reset.
  4. **About this map** (closed). How it's built, how to read distance (the paragraph from under the map) and the paper counts.

## 8. Order of work, checks and release

1. Sol removal and the usage panel.
2. Scan detection and the Evidence notices.
3. `theme-colors.ts`, wired through the dashboard and the paper window.
4. The merged Topics tab.
5. Area Analysis and Keyword Explorer re-layout.
6. Semantic map: wheel, PNG, side panel.
7. Docs.

**Checks**
- **Unit tests** for:
  - the colour map: stable under filters, grey past eight, ties by name;
  - scan classification, from the record and from page text;
  - the usage panel's content;
  - Sol's absence;
  - old `paperTab` links;
  - the PNG drawing, against a recording canvas.
- **Typecheck, lint and the whole suite.**
- **A production build checked in the browser,** in light and dark mode at 1440 and 390 px wide:
  - every dashboard tab;
  - the map's wheel, at the limits too;
  - the PNG download (a PNG header, the expected size);
  - the paper window on a typed paper, a scanned paper (be97ac25) and a partly scanned one if testtest has one;
  - the chat composer and usage panel.
- **Release:** development to test (pilot) and checked there, then main (production) on the user's go-ahead. That is one build each, to keep Cloud Build minutes down.

**Spend:** no model calls; two Cloud Build runs.

## 9. Results (2026-10-24)

The user chose the recommended option for each decision: eight colours and grey, one Topics tab, and one "Themes over time" card.

**Built as planned, with these details settled on the way.**
- **Theme colours.** `src/lib/theme-colors.ts`. The dashboard ranks themes from the repository's unfiltered rows. The paper window reads the same rows through the dashboard's own cache (`useRepositoryTrends`), so the two can't disagree and the window calls no model. A paper whose repository is not the one open shows its topics with no colour at all, since grey would mean "another theme".
- **Sol.** A Max plan saved with Sol as its writer before the change is now written by Luna (`sessionWriterModel`).
- **The Overview tab.** It also carried the Topics tab's first six topic cards; they are gone. The help pages still described the two-pane Evidence tab of before 2026-10-22, and now describe the PDF with marks.
- **Themes over time.** The Grid view leaves out picked themes that have only undated papers, so it never draws a row of zeros.
- **The free graph.** Its "Free graph" note sat over its zoom buttons; it is gone. On a phone the "Scroll to zoom" hint is hidden: there is no wheel there, and the hint covered the buttons.
- **The map's CSV.** The CSV helper (`semantic-map-export.ts`) is deleted with its test, since nothing used it once the PNG replaced it.

**Checks.**
- **Tests.** 1,384 pass, typecheck and lint are clean, and the new `tests/professor-review-2026-10-24.test.ts` covers this round.
- **Local browser harness.** The real components were run on testtest's real data, in light and dark mode at 1440 and 390 px:
  - Over the map, the wheel kept the page still in both layouts, including 25 steps past the zoom limits, while outside the map the page scrolled.
  - The PNG downloaded at 3200×2000.
  - **Show in PDF** opened the right passage, and it was in view.
  - The scanned thesis (be97ac25) showed **Scanned PDF**, the notice and all 10 passages, whether the decision came from the record or from its pages.
  - A testtest paper's topics carried their themes' colours and names.
  - No page errors.

## 10. Follow-up the same day

After seeing the pilot, the user asked for two changes.

**1. A scan's evidence is shown in its text.** The Evidence tab no longer shows a scan's pictures of pages with a list underneath. It shows the text the analysis read from the scan with OCR (`detail.raw_text`), as the Evidence tab did before 2026-10-22.
- **Layout.** The text is split at the OCR step's `[Page N]` markers, so each passage names the PDF's own page.
- **Marks.** Every passage is marked with the same matching as on the PDF (`locateMarks`); the one in focus is stronger.
- **Stepping.** Previous and Next evidence step through the passages in reading order.
- **Note.** A line says the PDF itself is on Preview.
- **Which papers.** A paper whose record says it is scanned shows the text view at once. An older paper switches to it once the viewer finds its pages have no text.
- **Labels.** On a scan, each keyword's button reads **Show in text**.
- **Styling.** The marks use new `.text-evidence-mark` styles without the multiply blend, which turns yellow black on the dark page. The component is `src/components/workspace/EvidenceText.tsx`.
- **Partly scanned papers** keep the PDF and the notice: most of their pages have text.

**2. Sixteen theme colours, not eight.** The question was whether every theme should get its own colour, with no grey. The answer given: testtest has 68 themes, 36 of them in a single paper, and that many colours cannot be told apart, so readers would take one theme for another. Sixteen was offered as the middle way, and the user chose it.
- **The colours.** The first eight take the chart colours. The next eight take a deeper shade of the same hues, set separately for the light and the dark page (`THEME_PALETTE` in `theme-colors.ts`).
- **The check.** Each set of sixteen passes the dataviz validator on its own page: lightness band, chroma, neighbours at least 15 apart for full-colour vision, and 3:1 against the page. Neighbours' colour-blind separation is 7.4–7.8. That is allowed because every theme is also named wherever it is coloured.
- **The effect.** In testtest, 38 of 41 papers now have a coloured theme, against 30 with eight colours, and 52% of keyword rows are coloured instead of 32%. The other themes, mostly single-paper ones, stay grey.
- **How it is stored.** `ThemeColors` now keeps each theme's slot (0–15), and the colour is resolved per page: `themeColor(colors, theme, dark)`.
