/*
 * A paper's analysis as a Markdown report, and the helpers to save it. Shared
 * by the Library and the paper viewer that opens on every other page.
 */
import { getRunDisplayTitle } from "@/lib/ingestion-status";
import type { IngestionRunRow, RunAnalysisDetail } from "@/types/database";

function titleOf(run: IngestionRunRow) {
  return getRunDisplayTitle(run, run.id);
}

export function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 120);
}

function cleanReportText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function quoteMarkdown(value: string | null | undefined) {
  const cleaned = cleanReportText(value);
  if (!cleaned) {
    return "_No evidence stored._";
  }
  return cleaned
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function buildAnalysisMarkdown(run: IngestionRunRow, detail: RunAnalysisDetail) {
  const title = cleanReportText(detail.title || titleOf(run)) || titleOf(run);
  const lines: string[] = [
    `# ${title}`,
    "",
    "## Report Metadata",
    `- Source file: ${detail.source_filename || run.source_filename || titleOf(run)}`,
    `- Year: ${detail.year || "Unknown"}`,
    `- Run ID: ${run.id}`,
    `- Paper ID: ${detail.paper_id || "Unavailable"}`,
    `- Status: ${run.status}`,
    `- Analysis source: ${detail.diagnostics?.dataSource || (detail.available ? "pipeline" : "unavailable")}`,
  ];

  // The year, and where it was read, so a reader can judge it.
  const extracted = detail.extracted;
  if (extracted?.year) {
    lines.push(`- Year source: ${extracted.year.source}`);
    if (cleanReportText(extracted.year.evidence)) {
      lines.push(`- Year evidence: "${cleanReportText(extracted.year.evidence)}"`);
    }
  }
  if (extracted?.typology) {
    lines.push(
      `- Research type: ${extracted.typology.primary}${extracted.typology.secondary ? ` (also ${extracted.typology.secondary})` : ""}`
    );
  }
  if (extracted?.duplicateOf) {
    lines.push(`- Possible copy of: "${extracted.duplicateOf.title}"`);
  }

  lines.push("", "## Research area");
  if (detail.classification) {
    const classification = detail.classification;
    lines.push(`- Profile: ${classification.taxonomyName}`);
    lines.push(`- Main research area: ${classification.primaryCategory}`);
    if (classification.additionalCategories.length > 0) {
      lines.push(`- Also: ${classification.additionalCategories.join(", ")}`);
    }
    if (classification.status === "previous_profile") {
      lines.push("- Classified under an earlier profile; reclassify to bring it up to date.");
    }
    if (cleanReportText(classification.rationale)) {
      lines.push("- Why:", quoteMarkdown(classification.rationale));
    }
  } else if (detail.tracksSingle.length > 0) {
    lines.push(...detail.tracksSingle.map((track) => `- Main research area: ${track}`));
    lines.push(...detail.tracksMulti.map((track) => `- Also: ${track}`));
  } else {
    lines.push("- Classification is not enabled for this repository.");
  }

  lines.push("", "## The Paper's Own Keywords");
  lines.push(
    extracted?.authorKeywords.length
      ? `- ${extracted.authorKeywords.join(", ")}`
      : "- The paper does not print a keyword list."
  );

  if (extracted?.methodTopics.length) {
    lines.push("", "## Methods", ...extracted.methodTopics.map((topic) => `- ${topic}`));
  }

  lines.push("", "## Topics");
  if (detail.topics.length > 0) {
    lines.push(...detail.topics.map((topic) => `- ${topic}`));
  } else {
    lines.push("- No topic labels were stored.");
  }

  lines.push("", "## Topics and Their Keywords");
  if (detail.concepts.length > 0) {
    for (const concept of detail.concepts) {
      lines.push(`### ${concept.label}`);
      lines.push(`- Total frequency: ${concept.totalFrequency}`);
      if (concept.matchedTerms.length > 0) {
        lines.push(`- Matched terms: ${concept.matchedTerms.join(", ")}`);
      }
      if (concept.relatedKeywords.length > 0) {
        lines.push(`- Related keywords: ${concept.relatedKeywords.join(", ")}`);
      }
      lines.push("- Evidence:");
      lines.push(quoteMarkdown(concept.firstEvidence || concept.evidenceSnippets[0] || null));
      lines.push("");
    }
  } else {
    lines.push("- No topic groups were stored.");
  }

  lines.push("## Analytical Facets");
  if (detail.facets.length > 0) {
    for (const facet of detail.facets) {
      lines.push(`- **${facet.facetType.replace(/_/g, " ")}**: ${facet.label}`);
      if (cleanReportText(facet.evidence)) {
        lines.push(`  - Evidence: ${cleanReportText(facet.evidence)}`);
      }
    }
  } else {
    lines.push("- No analytical facets were stored.");
  }

  lines.push("", "## Grounded Keywords");
  if (detail.keywords.length > 0) {
    for (const keyword of detail.keywords) {
      lines.push(`- **${keyword.keyword}**`);
      lines.push(`  - Topic: ${keyword.topic || "Unclassified topic"}`);
      lines.push(`  - Frequency: ${keyword.frequency}`);
      lines.push(`  - Evidence: ${cleanReportText(keyword.evidence) || "No supporting evidence stored."}`);
    }
  } else {
    lines.push("- No grounded keyword rows were available for this paper.");
  }

  for (const [label, value] of [
    ["Extracted Abstract Claims", detail.abstract_claims],
    ["Extracted Methods", detail.methods],
    ["Extracted Results", detail.results],
    ["Extracted Conclusion", detail.conclusion],
  ] as const) {
    lines.push("", `## ${label}`, "", cleanReportText(value) || "_No extracted text was available for this section._");
  }

  if (extracted?.analysisNotes.length) {
    lines.push("", "## Analysis Notes", ...extracted.analysisNotes.map((note) => `- ${note}`));
  }

  if (detail.warnings && detail.warnings.length > 0) {
    lines.push("", "## Warnings", ...detail.warnings.map((warning) => `- ${warning}`));
  }

  if (detail.diagnostics?.missingOutputs && detail.diagnostics.missingOutputs.length > 0) {
    lines.push(
      "",
      "## Diagnostics",
      ...detail.diagnostics.missingOutputs.map((item) => `- Missing output: ${item}`)
    );
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function triggerTextDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
