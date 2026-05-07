# Testing and Quality

## 1. Current Automated Test Inventory

Python tests currently present in tests directory:

- test_conversation_tools.py
- test_deep_research.py
- test_ingestion_extractor.py
- test_model_router.py
- test_supabase_http.py
- test_workspace_data.py

These provide foundational confidence for core non-UI logic and graph-adjacent behavior.

## 2. Covered Areas

## 2.1 Extraction Logic

- Ingestion extractor behavior
- Fallback handling pathways

## 2.2 Model Routing

- Task-level model selection behavior
- Fallback consistency

## 2.3 Conversation and Tooling

- Conversation assembly and tool-call logic

## 2.4 Deep Research

- Research flow behavior and synthesis lifecycle

## 2.5 Supabase HTTP Utilities

- Retry and transient error behavior

## 2.6 Workspace Data Access

- Scoped loading and filtering logic

## 3. Major Gaps

No direct automated coverage currently exists for:

- Next.js API route handlers
- Frontend React components and hooks
- Worker process integration with live Supabase tables
- End-to-end user workflows from upload to dashboard update
- Integration auth flows including Google Drive callback edge cases

## 4. Recommended Test Pyramid

## 4.1 Unit Tests

Focus:

- Node utility functions
- Parsing, normalization, and coercion helpers
- Route-level input validation helpers

## 4.2 Integration Tests

Focus:

- API route behavior with mocked Supabase and node service clients
- Worker process_batch behavior with controlled fixtures
- Persistence upsert correctness for repeated runs

## 4.3 End-to-End Tests

Focus:

- Sign in, create scope, upload file, monitor queue, verify dashboard refresh
- Chat and deep research flows using fixture datasets

## 5. Quality Gates for Production Changes

For major features:

1. Unit tests for new logic and helpers.
2. Integration tests for route and persistence behavior.
3. Build success on frontend app.
4. Worker dry-run verification in once mode.
5. Manual smoke test for upload and dashboard visibility.

## 6. Suggested CI Pipeline

Minimum CI stages:

1. Python lint and tests.
2. Frontend typecheck and build.
3. Optional route integration tests with mocked services.
4. Optional schema migration validation against disposable database.

## 7. Regression Risk Hotspots

Based on current architecture, prioritize regression checks for:

- Scope propagation (organization/project/folder)
- Queue status transitions and stale recovery
- Polling behavior under auth expiration
- Adaptive dashboard rerender behavior and planner caching
- Upload preparation and finalization handshake

## 8. Test Data Strategy

Maintain a reusable fixture set including:

- Clean English PDF
- Mixed-language PDF
- OCR-heavy scanned PDF
- Corrupt/partial PDF
- Large file near limit

This improves confidence in fallback logic and error handling paths.

## 9. Release Readiness Checklist

Before release:

1. All Python tests pass.
2. Frontend build passes.
3. Worker once-mode completes on sample queued runs.
4. Dashboard reads newly processed records in intended scope.
5. Chat returns grounded responses for known fixture prompts.

## 10. Long-Term Quality Improvements

- Add API contract tests for every route group.
- Add component tests for dashboard and ingestion UI.
- Add synthetic queue load tests.
- Add model output contract snapshots for critical extraction nodes.
- Add nightly E2E smoke jobs against staging environment.
