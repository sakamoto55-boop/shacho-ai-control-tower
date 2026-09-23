# Google login setup recovery

`tools/preflight/google_login_setup.py` is the tested source for step 3 of the
existing private operator notebook. The notebook supplies the approved project,
project number, company owner email, region and service to `configure(...)` before
calling `launch()`. Those settings and all credentials stay out of this repository.

Version 3.2 removes the obsolete hard-coded `source_head` from setup receipts.
Existing notebook callers remain compatible: without a source declaration the
receipt records `source_head: null` and `source_head_origin: unknown`. A pinned
loader may pass its full lowercase 40-character commit as `source_head` to
`configure(...)`, or set `DIOS_SETUP_SOURCE_HEAD` for the command-line entrypoint.
The receipt labels this `operator_declared` and keeps `source_head_verified: false`:
the setup script cannot prove its caller's source integrity or the deployed
application revision. The loader must independently check its downloaded bytes.
Reconfiguring without the argument clears any previous notebook execution's SHA.
Do not replace an old hard-coded SHA with another fixed value or infer deployment
completion from a setup receipt. The private notebook must load this updated
script before its receipts gain this behavior; a repository change alone does
not update that notebook.

Version 3.1 introduced:

- A read-only resume path: both existing Secret Manager versions must have the
  expected resource name, ownership labels, regional replication, active state,
  checksum, stored digest and valid client shape. A complete pair skips upload and
  performs zero cloud mutations.
- Partial first-time setup can continue with the same original Web client JSON.
  Conflicting values, disabled versions and multiple versions stop for review.
  The program never rotates or overwrites a credential.
- Separate phases for Google authentication, owner/project verification,
  existing credentials, file selection and registration. Authentication failures,
  upload failures and cancellation receive distinct safe codes. Free-form
  exception messages and credential values are never included in receipts.
- Exact origin comparison against Cloud Run v2 `urls[]` as well as legacy `uri`.

Run regression checks with:

```sh
python3 -m unittest discover -s tools/preflight -p test_google_login_setup.py -v
```

The tests use only synthetic values and an in-memory Google API double. They do
not authenticate, deploy or verify a real OAuth client. `OAUTH_CREDENTIALS_STAGED`
means the two stored values were verified. It does not mean the application was
deployed, the provider callback was freshly verified or an iPhone signed in.

The original Cloud SQL foundation cells in the private notebook must remain
unchanged. The existing foundation is read back before application deployment;
this recovery step does not recreate it or grant IAM permissions.

Provider reference: [Cloud Run v2 Service](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)
defines `urls[]` as the URLs serving traffic for the service.
