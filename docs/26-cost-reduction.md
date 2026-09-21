# Cost Reduction

Last updated: 2026-09-22 (Asia/Bangkok)
Context: the project is in testing. At most three people use it, usually nobody.
Observed bill: roughly 1,400 THB per month.

Every figure below is measured from the live project, not estimated from the
architecture. Prices are approximate and labelled as such; the measurements are
not.

## Where the money goes

| Item | Measured state | Approx. monthly | Status |
| --- | --- | ---: | --- |
| Cloud SQL `papertrend-pg` | `db-g1-small`, `activationPolicy: ALWAYS`, ZONAL, 10 GB PD_SSD | ~900 THB | decision required |
| Artifact Registry | 534 images, 67.6 GB, no cleanup policy | ~250 THB | fixed |
| GCS buckets | 2.4 GB across four buckets | ~10 THB | fine |
| Cloud Build | 727 of 2,500 free minutes used in 30 days | 0 | fine |
| Cloud Run | all six services at `minScale` 0, so no idle charge | ~0 | fine |
| Cloud Logging | `_Default` 30-day retention, `_Required` 400-day (fixed, free) | small | fine |

Cloud SQL is roughly two thirds of the bill and Artifact Registry most of the
rest. Nothing else is material at this scale.

## Fixed: container images were never deleted

Every Cloud Build deployment left its image behind permanently. The repository
had accumulated **534 images totalling 67.6 GB**, with no cleanup policy, and was
still growing with each deploy:

```text
212  papertrend-web-cloudsql-pilot
126  papertrend-node-service-staging
 62  papertrend-web-production
 46  papertrend-worker-production
 40  research-trend-analysis-node-service
 32  papertrend-worker-cloudsql-pilot
```

Both repositories now carry a cleanup policy:

- keep the 5 most recent versions of each image, and
- delete anything older than 30 days.

Cloud Run only needs the image its current revision references, and recent
rollback targets stay inside both rules, so nothing in use is at risk. Artifact
Registry applies policies asynchronously, so the reclaimed space appears within
about a day.

## Cloud SQL: what the measurements say

Seven days of Cloud Monitoring for `papertrend-pg`:

| Metric | Peak | Median |
| --- | ---: | ---: |
| Memory utilization | 41% of 1.7 GB (~0.70 GB) | 39.6% |
| Disk used | **0.16 GB** | 0.16 GB |
| CPU utilization | — | ~10% |
| Connections | 5 | **0** |

Two things follow.

The **entire database is 176 MB**. The 41% memory figure is PostgreSQL using the
RAM that happens to be available for cache; it is not a working-set requirement.
On a smaller instance PostgreSQL simply sizes its buffers down, and a 176 MB
dataset still fits comfortably.

The **median connection count is zero**. The instance is genuinely idle almost
all of the time, and peak concurrency of 5 matches `CLOUDSQL_POOL_MAX`.

### Options considered

**`db-f1-micro`, always on.** 0.6 GB RAM, shared core. The measured working set
fits, connection counts are far below the tier's limit, and CPU is near idle.
Saves roughly 550 THB per month with no change in behaviour and no manual step.
It carries no uptime SLA, which is acceptable for a project in testing.

**Stop the instance when not testing.** Saves the most, roughly 900 THB, leaving
only storage. Rejected as a default: **a stopped Cloud SQL instance does not
start on an incoming connection.** Someone has to start it explicitly and wait
one to two minutes, so an unannounced visit reaches a dead site.

**Scheduled overnight stop.** Cloud Scheduler stopping and starting on a fixed
timetable is automatic and saves in proportion to the hours chosen, but it is
time-based rather than demand-based, so a visit during the stopped window still
fails.

**Start-on-demand.** A request to a stopped instance could trigger a start, but
the first visitor waits one to two minutes on a holding page, and it is real
engineering for a saving `db-f1-micro` largely achieves without the complexity.

**Smaller machine than `db-f1-micro`.** There is none; custom machine types begin
at a dedicated vCPU and cost more than `db-g1-small`.

### Recommendation

Move to `db-f1-micro` and leave it running:

```powershell
gcloud sql instances patch papertrend-pg --tier=db-f1-micro
```

The change restarts the instance, so expect a short interruption. An on-demand
backup was taken beforehand (`pre-tier-change`), which matters because this
instance still has **no automated backups**.

Reverting is the same command with `--tier=db-g1-small`.

## Still open

- **Automated backups remain disabled** on the production database, with no
  point-in-time recovery and no deletion protection. This is a data-safety gap
  rather than a cost item, but the two interact: the cheapest safe configuration
  is worth deciding together.
- No budget alert exists, because the Cloud Billing Budget API has never been
  enabled on the project. Enabling it and setting an alert at a chosen monthly
  figure would turn a surprise into a warning.
