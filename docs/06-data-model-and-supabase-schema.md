# Data Model and Supabase Schema

## 1. Data Architecture Goals

The schema supports:

- Workspace scoping by organization, project, and folder
- Queue-based ingestion lifecycle management
- Canonical paper and content storage
- Derived analytics entities for trends, tracks, and facets
- Chat and deep research persistence

## 2. Core Workspace Entities

## 2.1 workspace_organizations

Purpose:

- Top-level ownership container for user work

Key fields:

- id
- owner_user_id
- name
- type
- created_at
- updated_at

## 2.2 workspace_projects

Purpose:

- Project grouping within organization

Key fields:

- id
- organization_id
- owner_user_id
- name
- description

## 2.3 research_folders

Purpose:

- Operational analysis scope for paper collections

Key fields:

- id
- owner_user_id
- organization_id
- project_id
- name
- description

## 2.4 user_profiles

Purpose:

- User metadata and workspace profile configuration

## 2.5 google_drive_connections

Purpose:

- OAuth token and account linkage for integration imports

## 3. Ingestion and Content Entities

## 3.1 ingestion_runs

Purpose:

- Lifecycle tracking for each ingestion job

Important fields:

- id
- owner_user_id
- folder_id
- folder_analysis_job_id
- source_type
- status
- source filename and path metadata
- input_payload
- error_message
- created_at, updated_at, completed_at

## 3.2 folder_analysis_jobs

Purpose:

- Group multiple runs into one folder-level analysis operation

Important fields:

- total, queued, processing, succeeded, failed counters
- progress_stage
- progress_message
- progress_detail

## 3.3 papers

Purpose:

- Canonical paper header record

Important fields:

- id
- owner_user_id
- folder_id
- year
- title

## 3.4 paper_content

Purpose:

- Canonical text sections and ingestion link

Important fields:

- raw_text
- abstract
- body
- methods
- results
- conclusion
- ingestion_run_id

## 4. Derived Analytics Entities

## 4.1 paper_keywords

Purpose:

- Keyword-level extracted trend signals

Typical fields:

- topic
- keyword
- keyword_frequency
- evidence

## 4.2 paper_keyword_concepts

Purpose:

- Higher-level concept grouping with evidence snippets

Typical fields:

- concept_label
- matched_terms
- related_keywords
- total_frequency
- evidence_snippets

## 4.3 paper_tracks_single

Purpose:

- Exclusive track classification flags

## 4.4 paper_tracks_multi

Purpose:

- Multi-label track classification flags

## 4.5 paper_analysis_facets

Purpose:

- Objective/contribution facet labels for higher-level analysis

## 5. Conversational and Research Entities

## 5.1 workspace_threads

Purpose:

- Chat thread metadata and mode

## 5.2 workspace_messages

Purpose:

- Message storage by role and thread

## 5.3 deep_research_sessions

Purpose:

- Long-running research session persistence

## 5.4 deep_research_steps

Purpose:

- Step-level status and output for research execution traceability

## 6. Views and Compatibility Contracts

The platform supports dashboard compatibility with flat analytical contracts, while maintaining richer canonical tables.

Contributors should verify any schema additions against:

- Existing dashboard readers
- Worker persistence logic
- API response shapes consumed by frontend hooks

## 7. Typical Query Patterns

## 7.1 Dashboard Read Pattern

- Scope by owner and optional folder/project
- Join or aggregate papers with keywords and tracks
- Apply year and track filters

## 7.2 Library Read Pattern

- List ingestion runs by scope
- Join run metadata with paper summaries

## 7.3 Queue Monitoring Pattern

- Filter ingestion runs by status and updated_at
- Aggregate run counts by folder_analysis_job_id

## 8. Data Integrity Considerations

- Ensure paper IDs are stable and unique.
- Preserve owner and folder scoping on all derived rows.
- Keep run status transitions monotonic and auditable.
- Prefer additive migrations and backward-compatible reads.

## 9. Migration Guidance

When changing schema:

1. Add fields/tables in additive fashion.
2. Backfill with safe defaults.
3. Update worker persistence and API readers.
4. Validate dashboard compatibility paths.
5. Document changes in this file and release notes.

## 10. Security Guidance

- Service role key must be server-side only.
- Validate per-user ownership in all API route writes.
- Keep OAuth tokens encrypted or securely scoped per provider best practices.
- Review row-level policies whenever new tables are introduced.
