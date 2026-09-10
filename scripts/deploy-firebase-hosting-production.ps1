param(
  [switch]$Apply,
  [string]$FirebaseCliVersion = "15.29.0"
)

$ErrorActionPreference = "Stop"
$ProjectId = "research-trend-analysis"
$Region = "asia-southeast1"
$ServiceName = "papertrend-web-production"
$PublicUrl = "https://research-trend-analysis.web.app"
$InternalUrl = "https://papertrend-web-production-javhavgdsq-as.a.run.app"
$Bucket = "gs://research-trend-analysis-papertrend-uploads-production"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$Gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

Set-Location $RepositoryRoot

if (-not (Test-Path $Gcloud)) {
  throw "Google Cloud CLI was not found at $Gcloud."
}

$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "main") {
  throw "Production Hosting can only be deployed from the main branch. Current branch: $Branch"
}

$Dirty = git status --porcelain
if ($LASTEXITCODE -ne 0 -or $Dirty) {
  throw "The main worktree must be clean before a production Hosting deployment."
}

$Service = & $Gcloud run services describe $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --format=json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect $ServiceName."
}

$Environment = @{}
foreach ($Entry in $Service.spec.template.spec.containers[0].env) {
  if ($null -ne $Entry.value) {
    $Environment[$Entry.name] = [string]$Entry.value
  }
}

$RequiredValues = @{
  "APP_PUBLIC_URL" = $InternalUrl
  "NEXT_PUBLIC_SITE_URL" = $PublicUrl
  "PROJECT_ANALYSIS_PROFILES_ENABLED" = "true"
  "SEMANTIC_MAP_ENABLED" = "true"
}
foreach ($Name in $RequiredValues.Keys) {
  if ($Environment[$Name] -ne $RequiredValues[$Name]) {
    throw "$Name is not ready on Cloud Run. Expected '$($RequiredValues[$Name])'; found '$($Environment[$Name])'. Wait for the main production build before deploying Hosting."
  }
}

$AllowedOrigins = $Environment["APP_ALLOWED_ORIGINS"] -split "[;,]" |
  ForEach-Object { $_.Trim().TrimEnd("/") } |
  Where-Object { $_ }
foreach ($Origin in @($PublicUrl, $InternalUrl)) {
  if ($Origin -notin $AllowedOrigins) {
    throw "APP_ALLOWED_ORIGINS does not include $Origin."
  }
}

$Health = Invoke-RestMethod -Method Get -Uri "$InternalUrl/api/health" -TimeoutSec 55
if (-not $Health.ok -or -not $Health.revision) {
  throw "The direct production health endpoint is not ready."
}

Write-Host "Preflight passed for revision $($Health.revision)."
if (-not $Apply) {
  Write-Host "No cloud state changed. Re-run with -Apply after reviewing this preflight."
  exit 0
}

& $Gcloud storage buckets update $Bucket `
  --project=$ProjectId `
  --cors-file="gcs-cors.papertrend-production.json"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to add the Firebase origin to production GCS CORS."
}

$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source
& $Npx --yes "firebase-tools@$FirebaseCliVersion" deploy `
  --only "hosting:production" `
  --project $ProjectId
if ($LASTEXITCODE -ne 0) {
  throw "Firebase Hosting deployment failed. If authentication was rejected, run 'npx firebase-tools@15.29.0 login --reauth' and retry."
}

node scripts/firebase-hosting-acceptance.mjs `
  --base-url $PublicUrl `
  --direct-url $InternalUrl
if ($LASTEXITCODE -ne 0) {
  throw "Hosting deployed, but the unauthenticated acceptance crawl failed. Keep using run.app while investigating."
}

Write-Host "Firebase Hosting is deployed as an unadvertised alias. Complete authenticated acceptance and the 48-hour observation gate before announcing it."
