# DIOS runtime integration

This implementation extends the existing TypeScript COMMAND application. It does not import the earlier standalone Python demonstrations or replace the existing evidence, scope checks, memory validation, or integrations.

## Development verification

- `npm ci --ignore-scripts`
- `npm run build`
- `npm test`
- `npm run test:dios:smoke`
- `npm run start:dios`

The `/dios` entry renders the existing responsive UI with DIOS branding. `/vui` remains unchanged. The default DIOS runtime uses the existing authenticated backend and does not silently select demo data. `DIOS_RUNTIME_MODE=preview` serves a display-only shell that never imports the business backend; its data requests explicitly return PREVIEW_ONLY.

## Release boundary

This repository contains two distinct entrypoints: `src/dios.ts` retains local-file storage and rejects running that mode on Cloud Run; `src/dios-cloud.ts` implements the PostgreSQL owner pilot with Google identity and durable conversation context. See [CLOUD_PILOT.md](CLOUD_PILOT.md) for that implementation and its live acceptance gates. A passing build or CI run does not establish the current GCP deployment state. Read back the existing foundation and reuse it; this source change neither provisions it nor proves deployment. Do not remove the local-mode gate to obtain a green deployment.

The PWA worker caches only a static offline notice. It does not cache API results, credentials, or company conversations. Native iPhone/Safari installation and production OAuth remain unverified. The chosen visual design still needs final visual acceptance; this change prioritizes using the existing operational logic safely.

## CI evidence

The DIOS verification workflow runs the existing tests, added runtime tests, OAuth setup tests, TypeScript build, lint, and actual compiled HTTP startup checks. Its dependency audit fails on moderate-or-higher findings. The separate cloud verification workflow requires disposable PostgreSQL tests, synthetic dump/restore and actual container startup. Neither workflow establishes production OAuth, backup recovery or device acceptance.

PowerShell entry wrappers select the Unix gcloud executable on Unix platforms and preserve the child process exit code. The original provisioning logic is in the adjacent `.core.ps1` files, unchanged. All provisioning tests use mock gcloud and never access a real cloud project.
