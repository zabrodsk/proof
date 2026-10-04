#!/usr/bin/env bash
set -euo pipefail

# Service settings live in Railway. Legacy railway.json applies one HTTP
# healthcheck to every service, including the worker, and is deprecated.
project_id=56186326-1345-460a-8faf-8b579c3f483b
environment_id=7c27c8ba-d406-4cf9-8cd6-92183254bbb4
web_id=4428fd8e-89a5-4e47-b2dc-f6215804e1fb
worker_id=5a56f391-540f-4eb7-a0cc-dc4997d02c45
landing_id=8644bc09-1d12-4832-99d2-071f8d0e1938

railway api 'mutation Configure($environment: String!, $web: String!, $worker: String!, $landing: String!) {
  web: serviceInstanceUpdate(environmentId: $environment, serviceId: $web, input: {
    dockerfilePath: "Dockerfile", railwayConfigFile: null, startCommand: null,
    healthcheckPath: "/health", healthcheckTimeout: 120,
    restartPolicyType: ON_FAILURE, restartPolicyMaxRetries: 3
  })
  worker: serviceInstanceUpdate(environmentId: $environment, serviceId: $worker, input: {
    dockerfilePath: "Dockerfile", railwayConfigFile: null,
    startCommand: "runuser -u node -- npm run worker", healthcheckPath: null,
    restartPolicyType: ON_FAILURE, restartPolicyMaxRetries: 5
  })
  landing: serviceInstanceUpdate(environmentId: $environment, serviceId: $landing, input: {
    dockerfilePath: "Dockerfile.landing", railwayConfigFile: null, startCommand: null,
    healthcheckPath: "/health", healthcheckTimeout: 120,
    restartPolicyType: ON_FAILURE, restartPolicyMaxRetries: 3
  })
}' --var "environment=$environment_id" --var "web=$web_id" --var "worker=$worker_id" --var "landing=$landing_id" --compact

for service_id in "$web_id" "$worker_id" "$landing_id"; do
  railway service source connect --repo zabrodsk/proof --branch main \
    --project "$project_id" --environment "$environment_id" --service "$service_id" --json
done
