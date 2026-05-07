# Papertrend Extractor LLM Documentation

This directory contains comprehensive technical documentation for the full workspace.

## Scope

This documentation covers:

- Root Python ingestion and graph runtime
- Python node service and queue endpoints
- Next.js dashboard application
- Next.js API routes
- Worker queue processors
- Analysis pipeline internals
- Prompt contracts
- Supabase schema and data contracts
- Deployment and operations runbooks
- Testing coverage and quality gaps
- Module-by-module catalog

## Document Map

1. [System Overview and Architecture](01-system-overview-and-architecture.md)
2. [Setup and Local Development](02-setup-and-local-development.md)
3. [Frontend and API Architecture](03-frontend-and-api-architecture.md)
4. [Python Graphs and Nodes](04-python-graphs-and-nodes.md)
5. [Worker Queue and Analysis Pipeline](05-worker-queue-and-analysis-pipeline.md)
6. [Data Model and Supabase Schema](06-data-model-and-supabase-schema.md)
7. [Testing and Quality](07-testing-and-quality.md)
8. [Deployment and Operations Runbook](08-deployment-and-operations-runbook.md)
9. [Module Catalog](09-module-catalog.md)

## Reading Order

Recommended order for new contributors:

1. System Overview and Architecture
2. Setup and Local Development
3. Frontend and API Architecture
4. Python Graphs and Nodes
5. Worker Queue and Analysis Pipeline
6. Data Model and Supabase Schema
7. Deployment and Operations Runbook
8. Module Catalog

## Security Note

Never commit real secrets in environment files. If secrets have been committed at any time, rotate them immediately in provider dashboards and replace repository values with placeholders.
