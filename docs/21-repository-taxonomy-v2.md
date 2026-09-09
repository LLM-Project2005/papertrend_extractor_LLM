# Repository Taxonomy And Custom Track V2

## Purpose

Classification now belongs to a repository, not to the whole account and not to an individual upload. A repository uses one of three profiles:

- **General Research:** extracts normal paper metadata, topics, keywords, and findings without a category-model call.
- **EIL Tracks:** uses the official EL, ELI, and LAE definitions and boundary rules.
- **Custom Taxonomy:** uses 2-12 owner-defined categories plus the automatic `Other / Unclassified` fallback.

Every upload reads the current profile from the authenticated Cloud SQL project. Browser-supplied taxonomy data is not authoritative. Each ingestion run keeps an immutable profile snapshot so a historical result remains explainable after the repository profile changes.

## Data Contract

`workspace_projects` stores the normalized profile, profile version, canonical hash, and update time. Dynamic category definitions and assignments store project ID, profile hash/version, publication revision, classifier model, and classification time.

Historical rows recover provenance from ingestion snapshots when possible. Rows that cannot be resolved are explicitly marked `legacy`; they are not guessed into the current profile.

Reclassification uses `project_reclassification_jobs` and `project_reclassification_items`. Results are staged per paper. The previous live revision remains active until every eligible item succeeds and the replacement publishes in one transaction.

## Pilot Migration

Run these steps from PowerShell at the repository root. The Cloud SQL Auth Proxy must be listening on `127.0.0.1:5432`.

1. Load the Cloud SQL database secret without printing it:

```powershell
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$env:DATABASE_URL = (& $gcloud secrets versions access latest `
  --secret=DATABASE_URL `
  --project=research-trend-analysis).Trim()
```

2. Apply the additive schema migration with a database owner account:

```powershell
cd eil-dashboard
npm run cloudsql:migrate -- cloudsql/20260910_project_analysis_profiles.sql --apply
```

If the `DATABASE_URL` secret uses `papertrend_app`, Cloud SQL may correctly reject `ALTER TABLE`. In that case, open Google Cloud Console, go to **SQL**, select **papertrend-pg**, open **Cloud SQL Studio**, choose database **papertrend**, authenticate as **postgres**, paste `eil-dashboard/cloudsql/20260910_project_analysis_profiles.sql`, and run all statements. Do not grant `papertrend_app` schema-owner privileges as a workaround.

3. Preview canonical project-profile migration:

```powershell
npm run cloudsql:migrate-project-profiles -- --owner-user-id "OWNER_UUID"
```

Review each repository mode and the number marked `changed`. Then apply:

```powershell
npm run cloudsql:migrate-project-profiles -- --owner-user-id "OWNER_UUID" --apply
```

The runtime `papertrend_app` role uses forced owner RLS, so a local proxy run must identify exactly one owner. Run both commands once for each mapped pilot owner. The script intentionally refuses to report a misleading zero-project success when no owner context is supplied.

4. Verify columns, forced RLS, owner policies, and app-role access:

```powershell
npm run cloudsql:verify-project-profiles
```

The result must contain `"ok": true` and an empty `failures` array.

## Evaluation

Validate the versioned benchmark without calling a model:

```powershell
npm run taxonomy:eval -- --validate-only
```

Run the live model evaluation after `OPENAI_API_KEY` and `OPENAI_BASE_URL` are available:

```powershell
npm run taxonomy:eval
```

The report includes primary accuracy, macro-F1, invalid-key rate, `Other` precision/recall, latency, token use, reported OpenRouter cost, and every disagreement. Any disagreement requires expert review before production approval. Invalid-key rate and cross-owner leakage must remain zero.

## Browser Acceptance

Use only `papertrend-web-cloudsql-pilot` during acceptance.

1. Create one General Research repository and confirm upload analysis has no meaningful category badge.
2. Create one EIL repository and confirm an instructional intervention maps to ELI while test validation maps to LAE.
3. Create a Custom Taxonomy repository with four categories; upload two papers and confirm only allowed keys appear.
4. Copy that profile into a second repository, edit the copy, and confirm the source repository does not change.
5. Change a repository profile and confirm the upload modal warns about earlier-profile papers without clearing selected PDFs.
6. Open **Settings > Analysis & classification**, save the profile, then reclassify existing papers.
7. Confirm progress updates, completion publishes the new categories, dashboard charts exclude old-profile assignments, and the semantic map becomes stale.
8. Force or simulate one failed item, confirm the old revision remains visible, then use **Retry failed papers**.
9. Start another job and cancel it; confirm no partial revision is published.
10. Repeat profile, template, job, and paper-detail access with user B and verify user B cannot see or change user A data.
11. Check creation, settings, upload, and paper detail at 320px, 375px, 414px, 768px, and desktop in both themes using keyboard navigation.

## Rollout Boundary

The pilot sets `PROJECT_ANALYSIS_PROFILES_ENABLED=true`. Production configuration is unchanged. Do not merge to `main`, enable the production flag, or send production traffic to this revision until schema verification, automated tests, live evaluation, and two-user browser acceptance pass.
