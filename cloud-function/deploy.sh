#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PROJECT=$(gcloud config get-value project 2>/dev/null)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SECRET_NAME="github-token"
REGION="us-east1"
FUNCTION_NAME="lights-out"
GITHUB_OWNER="gevrai"
GITHUB_REPO="gevrai"

# Ensure required GCP services are enabled
REQUIRED_SERVICES="cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com"
echo "==> Checking required GCP services..."
ENABLED=$(gcloud services list --enabled --format='value(config.name)' 2>/dev/null)
MISSING=()
for svc in $REQUIRED_SERVICES; do
  if ! echo "$ENABLED" | grep -q "^${svc}$"; then
    MISSING+=("$svc")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "    Enabling: ${MISSING[*]}"
  gcloud services enable "${MISSING[@]}"
else
  echo "    All services already enabled."
fi

# Create or update the secret
echo "==> Setting up Secret Manager..."
if gcloud secrets describe "$SECRET_NAME" &>/dev/null; then
  read -rsp "Enter GitHub PAT to update secret (or press Enter to keep existing): " GITHUB_TOKEN
  echo
  if [ -n "$GITHUB_TOKEN" ]; then
    echo -n "$GITHUB_TOKEN" | gcloud secrets versions add "$SECRET_NAME" --data-file=-
    echo "    Secret updated."
  else
    echo "    Keeping existing secret."
  fi
else
  read -rsp "Enter GitHub PAT (repo contents read/write): " GITHUB_TOKEN
  echo
  echo -n "$GITHUB_TOKEN" | gcloud secrets create "$SECRET_NAME" --data-file=- --replication-policy=automatic
  echo "    Secret created."
fi

# Grant the Cloud Function's service account access to the secret
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "==> Granting secret access to service account..."
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null
echo "    Done."

echo "==> Building TypeScript..."
npm run build

echo "==> Deploying to Google Cloud Functions..."
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime=nodejs22 \
  --region="$REGION" \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=lightsOut \
  --source=. \
  --set-secrets="GITHUB_TOKEN=${SECRET_NAME}:latest" \
  --set-env-vars="GITHUB_OWNER=${GITHUB_OWNER},GITHUB_REPO=${GITHUB_REPO}" \
  --memory=256MB \
  --max-instances=1 \
  --concurrency=1

FUNCTION_URL=$(gcloud functions describe "$FUNCTION_NAME" --gen2 --region="$REGION" --format='value(serviceConfig.uri)')

echo ""
echo "==> Deployed successfully!"
echo "    Function URL: ${FUNCTION_URL}/?action=new"
