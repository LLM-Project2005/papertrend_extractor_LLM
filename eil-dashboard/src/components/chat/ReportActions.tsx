"use client";

import MarkdownActions from "@/components/chat/MarkdownActions";
import { reportFileName, reportMarkdown, type ExportCitation } from "@/lib/deep-research/export";

/** Copy and Download for a finished deep research report. */
export default function ReportActions({ content, citations, title }: { content: string; citations: ExportCitation[]; title: string }) {
  return (
    <MarkdownActions
      markdown={() => reportMarkdown(content, citations)}
      fileName={reportFileName(title)}
      copyLabel="Copy report"
      label="Report actions"
    />
  );
}
