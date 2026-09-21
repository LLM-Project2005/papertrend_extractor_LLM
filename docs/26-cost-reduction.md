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

Applied 2026-09-22; the operation took 10 minutes and the instance has been
healthy on the new tier since. An on-demand backup was taken beforehand
(`pre-tier-change-20260922`), which matters because this instance still has
**no automated backups**.

Reverting is the same command with `--tier=db-g1-small`, and costs another
10-minute interruption.

## How to run the tier change, step by step

You do not need to install anything. `gcloud` is already on this machine
(SDK 560.0.0) and already signed in as `p.chantarusorn@gmail.com` on project
`research-trend-analysis`, which is the account that owns the instance.

### Step 1 - open a terminal

Open **PowerShell** on Windows (Start menu, type `powershell`). Any folder is
fine; this command does not touch the repository.

If you would rather not use your own machine at all, open
<https://console.cloud.google.com> , make sure the project selector at the top
says **research-trend-analysis**, and click the **Activate Cloud Shell** icon
(`>_`) in the top right. That gives you the same `gcloud`, already signed in, in
a browser tab. Every command below works unchanged in either place.

### Step 2 - confirm you are pointed at the right project

```powershell
gcloud config list
```

Expected:

```text
account = p.chantarusorn@gmail.com
project = research-trend-analysis
```

If the project is different, fix it before going further:

```powershell
gcloud config set project research-trend-analysis
```

### Step 3 - check the backup exists

The instance has **no automated backups**, so the on-demand backup is the only
thing standing between a mistake and data loss. Verify it before changing
anything:

```powershell
gcloud sql backups list --instance=papertrend-pg --limit=3
```

You should see `pre-tier-change-20260922` with status `SUCCESSFUL`. If you do
not, take a fresh one and wait for it to finish:

```powershell
gcloud sql backups create --instance=papertrend-pg --description=pre-tier-change
```

### Step 4 - note the current tier, so you know what to go back to

```powershell
gcloud sql instances describe papertrend-pg --format="value(settings.tier)"
```

This prints `db-g1-small` today. That string is your rollback value.

### Step 5 - run the change

```powershell
gcloud sql instances patch papertrend-pg --tier=db-f1-micro
```

`gcloud` warns that the instance will restart and asks `Do you want to
continue (Y/n)?`. Type `Y` and press Enter.

**The site is down while it restarts.** Measured on 2026-09-22 the operation
took **10 minutes 2 seconds** end to end (22:05:23 to 22:15:25 UTC), and the
`gcloud` spinner sits on `Patching Cloud SQL instance...` for all of it. That is
normal and not a hang: the instance comes back on the new tier partway through
and the command stays attached until the server-side operation is marked DONE.

Do this when nobody is testing. Closing the terminal does not cancel anything -
the operation runs server-side - but leave it open if you want to see it finish.

To check progress from another terminal:

```powershell
gcloud sql operations list --instance=papertrend-pg --limit=1
gcloud sql instances describe papertrend-pg --format="value(settings.tier,state)"
```

The instance reporting the new tier and `RUNNABLE` means the database is already
serving, even while the operation still shows `RUNNING`.

### Step 6 - confirm it worked

```powershell
gcloud sql instances describe papertrend-pg --format="value(settings.tier,state)"
```

Expected: `db-f1-micro  RUNNABLE`.

Then open the site and ask the chat one question. A real answer end to end is
better proof than any metric, because it exercises the database through the
same path a visitor uses.

### If something goes wrong

Go back with the value from step 4:

```powershell
gcloud sql instances patch papertrend-pg --tier=db-g1-small
```

That is another restart of the same length. The database contents are untouched
by a tier change in either direction - only the machine underneath it changes.

### What to watch afterwards

### Do not panic at 100% memory

**On `db-f1-micro`, `database/memory/utilization` reads 100% permanently, and
that is normal.** Measured immediately after the change, at idle:

| Metric | Reading | Meaning |
| --- | ---: | --- |
| `memory/utilization` | **100%** | all RAM accounted for |
| `memory/usage` | 614 MB | the whole machine - f1-micro has ~0.6 GB |
| `memory/total_usage` | **105-131 MB** | what is genuinely in use |
| `database/up` | 1.0 throughout | no restart, no OOM kill |
| `cpu/utilization` | ~8% | idle |

Linux uses whatever RAM is free as reclaimable page cache, so utilization pins
at 100% on a small machine while the real working set stays near 130 MB. An
earlier version of this document said to roll back above 90% utilization. That
advice was wrong and would have triggered a needless rollback. **Judge
`total_usage` and `database/up`, not `utilization`.**

Roll back if you see `database/up` dropping to 0 outside a deliberate restart,
`total_usage` approaching 614 MB, or connection errors during ordinary use.

There is no `gcloud monitoring time-series` command; read the metrics through
the API (this is the exact command, run and verified):

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -G "https://monitoring.googleapis.com/v3/projects/research-trend-analysis/timeSeries"   -H "Authorization: Bearer $TOKEN"   --data-urlencode 'filter=metric.type="cloudsql.googleapis.com/database/memory/total_usage" AND resource.labels.database_id="research-trend-analysis:papertrend-pg"'   --data-urlencode "interval.startTime=$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"   --data-urlencode "interval.endTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Or open Cloud Console -> SQL -> papertrend-pg -> Monitoring, which needs no
command at all.

### Verified after the change

Ten consecutive real questions against production on the new tier: **10 of 10
succeeded**, p50 27.3s, p95 29.5s - within noise of the 25.0s p50 measured on
the larger tier. Peak connections 3, peak working set 131 MB, no restart.

## Still open

- **Automated backups remain disabled** on the production database, with no
  point-in-time recovery and no deletion protection. This is a data-safety gap
  rather than a cost item, but the two interact: the cheapest safe configuration
  is worth deciding together.
- No budget alert exists, because the Cloud Billing Budget API has never been
  enabled on the project. Enabling it and setting an alert at a chosen monthly
  figure would turn a surprise into a warning.
