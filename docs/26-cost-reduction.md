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

**The site is down while it restarts** - usually one to three minutes. Do this
when nobody is testing. The command keeps running until the restart finishes;
do not close the window.

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

The risk of the smaller tier is memory, not disk or CPU. Watch it for a few days:

```powershell
gcloud monitoring time-series list --project=research-trend-analysis `
  --filter='metric.type="cloudsql.googleapis.com/database/memory/utilization" AND resource.labels.database_id="research-trend-analysis:papertrend-pg"' `
  --format="value(points[0].value.doubleValue)"
```

Measured on `db-g1-small` the peak was 41% of 1.7 GB, about 0.70 GB, against a
176 MB database - most of that is cache PostgreSQL takes because it is free, and
it sizes down on a smaller machine. If utilization sits above roughly 90% under
normal use, or you see connection errors during testing, roll back and tell me;
that would mean the working set is genuinely larger than the measurement showed.

## Still open

- **Automated backups remain disabled** on the production database, with no
  point-in-time recovery and no deletion protection. This is a data-safety gap
  rather than a cost item, but the two interact: the cheapest safe configuration
  is worth deciding together.
- No budget alert exists, because the Cloud Billing Budget API has never been
  enabled on the project. Enabling it and setting an alert at a chosen monthly
  figure would turn a surprise into a warning.
