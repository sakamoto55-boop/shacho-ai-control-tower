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

No cloud service has been provisioned or deployed by this change. The existing stores are local-file stores, not a managed transactional database. Running the local DIOS mode on Cloud Run is intentionally rejected until durable storage, identity, backup/restore, and live-data acceptance are implemented. Do not remove this gate just to obtain a green deployment.

The PWA worker caches only a static offline notice. It does not cache API results, credentials, or company conversations. Native iPhone/Safari installation and production OAuth remain unverified. The chosen visual design still needs final visual acceptance; this change prioritizes using the existing operational logic safely.

## CI evidence

The DIOS verification workflow runs the existing tests, added runtime tests, TypeScript build, lint, and actual compiled HTTP startup checks. It records a dependency advisory report separately; green unit tests do not mean that advisory findings or production release gates are resolved.

PowerShell entry wrappers select the Unix gcloud executable on Unix platforms and preserve the child process exit code. The original provisioning logic is in the adjacent `.core.ps1` files, unchanged. All provisioning tests use mock gcloud and never access a real cloud project.
