#!/usr/bin/env bash
set -euo pipefail

gcloud beta run services logs tail lights-out --region=us-east1 "$@"
