# Repository Semantic Map

## Purpose

The Semantic Map is an exploratory Dashboard view. Each active, successfully analyzed paper is represented by one structured document embedding. Coordinates preserve semantic neighborhoods; relationship edges use Euclidean distance from the original 1,536-dimensional vectors.

The map must not be interpreted as proof of citation, causation, paper quality, or agreement.

## Data Flow

1. The authenticated API verifies that the requested project belongs to the mapped owner.
2. Cloud SQL supplies title, year, abstract claims, objective facets, methods, results, conclusion, dynamic categories, topics, keywords, and track.
3. The service builds and hashes a bounded document representation. Full paper bodies are not sent for map embedding.
4. Existing vectors with the same paper, content hash, model, and representation version are reused.
5. Missing vectors are generated through the configured OpenRouter embedding endpoint in batches.
6. Euclidean distance, mutual-neighbor edges, deterministic clusters, and PCA/UMAP coordinates are computed server-side.
7. Cloud SQL stores a versioned snapshot. The browser receives metadata, points, and edges only, never vectors or source text.

## Projection Policy

- One paper: centered point.
- Two through twelve papers: PCA.
- Thirteen through fifty papers: UMAP using Euclidean distance, ten or fewer neighbors, minimum distance `0.2`, and seed `42`.
- UMAP failures fall back to PCA and are recorded in quality metadata.

The map records neighborhood preservation, cluster silhouette, edge count, and disconnected-paper count. Cluster names are grounded in supplied categories/topics/keywords and have a deterministic fallback.

## Pilot Setup

1. Run `eil-dashboard/cloudsql/20260909_dynamic_paper_categories.sql` if dynamic categories have not already been installed.
2. Run `eil-dashboard/cloudsql/20260909_repository_semantic_map.sql` as the Cloud SQL `postgres` administrator.
3. Run `eil-dashboard/cloudsql/20260915_semantic_map_euclidean.sql` when upgrading an existing Semantic Map installation.
4. Build the `test` branch with `cloudbuild.web.cloudsql.pilot.yaml`.
5. Confirm the pilot has `SEMANTIC_MAP_ENABLED=true` and `SEMANTIC_MAP_TASKS_QUEUE=papertrend-ingestion-staging`.
6. Open a repository's Dashboard and select the Semantic Map tab.

Production configuration intentionally does not enable this feature yet.

## Acceptance Checklist

- Every active successful paper appears exactly once; failed and trashed runs do not appear.
- A user cannot read another owner's maps, jobs, points, edges, or vectors.
- Search and display filters do not regenerate or move the map.
- The main application navigation remains unchanged; neighborhood labels and relationship details live in the Semantic Map's own inspector.
- The overview draws only the strongest sparse relationships, while selecting a paper reveals its nearest connections.
- Repository changes show `Map out of date`; coordinates remain stable until `Update map` is selected.
- Clicking a paper opens its existing analysis view.
- Multi-selection transfers only those successful run IDs to chat.
- An embedding or projection failure leaves the previous successful revision available.
- Light, dark, narrow-screen, keyboard, and reduced-motion behavior are usable.

## Repository And Ingestion Compatibility

The product presents a flat repository-to-files structure. Legacy folder rows remain an internal compatibility layer for ingestion jobs and foreign keys, but users do not choose, create, move, or search those rows.

The ingestion pipeline accepts journal articles, theses, dissertations, and bilingual Thai/English documents. It preserves headings, recognizes chapter-based Thai and English section names, translates manageable documents in chunks, and keeps long multilingual documents intact instead of issuing an oversized translation request. Scanned long documents sample front, middle, and final pages for OCR rather than reading only the opening pages.
