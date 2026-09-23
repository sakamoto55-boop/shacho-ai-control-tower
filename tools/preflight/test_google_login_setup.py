"""Offline regression coverage: no Google credentials, network or cloud writes."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('setup', Path(__file__).with_name('google_login_setup.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class MemoryGoogle(setup.Google):
    def __init__(self):
        super().__init__(SimpleNamespace(valid=True), None, None)
        self.stored = {}
        self.service = None
        self.reads = []
        self.writes = []
        self.fail_at = None

    def _request(self, method, url, body=None, params=None, missing=False):
        if method == 'GET':
            self.reads.append(url)
            if url == setup.IDENTITY:
                return {'email': setup.OWNER, 'email_verified': True, 'sub': 'synthetic-owner'}
            if url == setup.CRM:
                return {'projectId': setup.PROJECT, 'projectNumber': setup.NUMBER, 'lifecycleState': 'ACTIVE'}
            if url == setup.RUN:
                return copy.deepcopy(self.service)
            for name, item in self.stored.items():
                root = setup.SM + '/' + name
                if url == root:
                    return copy.deepcopy(item['metadata'])
                if url == root + '/versions':
                    return copy.deepcopy({'versions': item['versions']})
                for version in item['versions']:
                    if url == 'https://secretmanager.googleapis.com/v1/' + version['name'] + ':access':
                        raw = item['data']
                        return {'name': version['name'], 'payload': {
                            'data': base64.b64encode(raw).decode(),
                            'dataCrc32c': str(item.get('checksum', setup.crc32c(raw)))}}
            if missing:
                return None
            raise AssertionError('Unexpected GET route')
        self.writes.append(url)
        if len(self.writes) == self.fail_at:
            raise RuntimeError('synthetic failure with secret that must not be printed')
        if url == setup.SM:
            name = params['secretId']
            assert name not in self.stored
            metadata = {'name': 'projects/' + setup.NUMBER + '/secrets/' + name, **body}
            self.stored[name] = {'metadata': metadata, 'versions': []}
            return copy.deepcopy(metadata)
        for name, item in self.stored.items():
            if url == setup.SM + '/' + name + ':addVersion':
                raw = base64.b64decode(body['payload']['data'])
                assert setup.crc32c(raw) == int(body['payload']['dataCrc32c'])
                item['data'] = raw
                version = {'name': item['metadata']['name'] + '/versions/1', 'state': 'ENABLED'}
                item['versions'].append(version)
                return copy.deepcopy(version)
        raise AssertionError('Unexpected POST route')


class SetupTests(unittest.TestCase):
    def setUp(self):
        setup.configure(project='dios-tests', number='123456789012', owner='owner@example.com',
                        region='asia-northeast1', service='owner-pilot')
        self.g = MemoryGoogle()
        self.web = {'project_id': setup.PROJECT,
                    'client_id': setup.NUMBER + '-synthetic.apps.googleusercontent.com',
                    'client_secret': 'synthetic-only-secret-0123456789',
                    'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                    'token_uri': 'https://oauth2.googleapis.com/token',
                    'redirect_uris': [setup.CALLBACK]}
        self.upload_calls = 0

    def raw(self):
        return json.dumps({'web': self.web}).encode()

    def upload(self):
        self.upload_calls += 1
        return self.raw()

    def run_flow(self, authenticate=lambda: None, upload=None):
        return setup.run_setup(authenticate, lambda: self.g, upload or self.upload)[0]

    def seed(self):
        result = self.run_flow()
        self.assertEqual(result['status'], 'OAUTH_CREDENTIALS_STAGED')
        self.g.mutations = 0
        self.g.writes.clear()
        self.upload_calls = 0

    def test_first_run_verifies_both_values_and_clears_prepared_values(self):
        r = self.run_flow()
        self.assertEqual(r['cloud_mutations_attempted'], 4)
        self.assertEqual(len(r['stored_secret_versions']), 2)
        self.assertEqual(r['status'], 'OAUTH_CREDENTIALS_STAGED')
        self.assertIsNone(self.g.prepared)
        self.assertFalse(r['actual_google_login_verified'])
        self.assertFalse(r['dios_deployed_by_this_step'])
        self.assertNotIn(self.web['client_secret'], json.dumps(r))

    def test_legacy_notebook_does_not_invent_source_or_deployment_proof(self):
        r = self.run_flow()
        self.assertEqual(r['status'], 'OAUTH_CREDENTIALS_STAGED')
        self.assertIsNone(r['source_head'])
        self.assertEqual(r['source_head_origin'], 'unknown')
        self.assertFalse(r['source_head_verified'])
        self.assertFalse(r['dios_deployed_by_this_step'])

    def test_explicit_source_is_preserved_but_not_claimed_verified_on_resume(self):
        self.seed()
        head = 'a' * 40
        setup.configure(project=setup.PROJECT, number=setup.NUMBER, owner=setup.OWNER,
                        region=setup.REGION, service=setup.SERVICE, source_head=head)
        r = self.run_flow()
        self.assertTrue(r['resumed_existing'])
        self.assertEqual(r['source_head'], head)
        self.assertEqual(r['source_head_origin'], 'operator_declared')
        self.assertFalse(r['source_head_verified'])
        self.assertEqual(self.g.writes, [])

    def test_reconfiguration_clears_previous_source_head(self):
        setup.configure(project=setup.PROJECT, number=setup.NUMBER, owner=setup.OWNER,
                        region=setup.REGION, service=setup.SERVICE, source_head='b' * 40)
        setup.configure(project=setup.PROJECT, number=setup.NUMBER, owner=setup.OWNER,
                        region=setup.REGION, service=setup.SERVICE)
        self.assertIsNone(self.run_flow()['source_head'])

    def test_invalid_provenance_is_rejected_without_echoing_input_or_cloud_calls(self):
        for value in ('691797e', 'main', 'secret-value-not-a-commit', 'A' * 40, 123):
            with self.subTest(value=value):
                with self.assertRaisesRegex(setup.Stop, '^SETUP_SOURCE_HEAD_INVALID$'):
                    setup.configure(project=setup.PROJECT, number=setup.NUMBER, owner=setup.OWNER,
                                    region=setup.REGION, service=setup.SERVICE, source_head=value)
        self.assertEqual(self.g.reads, [])
        self.assertEqual(self.g.writes, [])

    def test_registered_pair_resumes_without_upload_or_mutation(self):
        self.seed()
        r = self.run_flow()
        self.assertTrue(r['resumed_existing'])
        self.assertEqual(r['cloud_mutations_attempted'], 0)
        self.assertEqual(self.upload_calls, 0)
        self.assertEqual(self.g.writes, [])
        self.assertEqual(len(r['stored_secret_versions']), 2)

    def test_partial_setup_finishes_only_missing_second_secret(self):
        self.seed()
        del self.g.stored[setup.SECRET_VALUE]
        r = self.run_flow()
        self.assertEqual(r['status'], 'OAUTH_CREDENTIALS_STAGED')
        self.assertEqual(r['cloud_mutations_attempted'], 2)
        self.assertEqual(self.upload_calls, 1)
        self.assertEqual(len(self.g.stored[setup.SECRET_ID]['versions']), 1)

    def test_partial_setup_with_different_client_is_not_overwritten(self):
        self.seed()
        del self.g.stored[setup.SECRET_VALUE]
        self.web['client_id'] = setup.NUMBER + '-different.apps.googleusercontent.com'
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'EXISTING_SECRET_CONFLICT')
        self.assertEqual(self.g.writes, [])

    def test_rejects_duplicate_json_key(self):
        with self.assertRaisesRegex(setup.Stop, 'DUPLICATE_JSON_KEY'):
            setup.validate_client(b'{"web":{},"web":{}}')

    def test_rejects_other_project_and_client(self):
        self.web['project_id'] = 'other-project'
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'OAUTH_PROJECT_MISMATCH')
        self.assertEqual(r['cloud_mutations_attempted'], 0)

    def test_rejects_unregistered_redirect(self):
        self.web['redirect_uris'] = ['https://attacker.example/callback']
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'REDIRECT_URI_MISMATCH')
        self.assertEqual(self.g.writes, [])

    def test_foreign_secret_ownership_prevents_upload_and_writes(self):
        self.seed()
        self.g.stored[setup.SECRET_ID]['metadata']['labels']['dios_module'] = 'unrelated'
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'EXISTING_SECRET_CONFLICT')
        self.assertEqual(self.upload_calls, 0)
        self.assertEqual(self.g.writes, [])

    def test_checksum_failure_does_not_claim_success(self):
        self.seed()
        self.g.stored[setup.SECRET_VALUE]['checksum'] = 1
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'SECRET_READBACK_MISMATCH')
        self.assertEqual(r['stored_secret_versions'], [])
        self.assertEqual(self.g.writes, [])

    def test_existing_disabled_version_is_not_replaced(self):
        self.seed()
        self.g.stored[setup.SECRET_ID]['versions'][0]['state'] = 'DISABLED'
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'SECRET_VERSION_INVALID')
        self.assertEqual(self.g.writes, [])

    def test_multiple_versions_require_review(self):
        self.seed()
        v = self.g.stored[setup.SECRET_VALUE]['versions']
        v.append({**v[0], 'name': v[0]['name'].replace('/1', '/2')})
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'EXISTING_SECRET_NEEDS_REVIEW')
        self.assertEqual(self.g.writes, [])

    def test_accepts_exact_callback_origin_in_cloud_run_urls(self):
        self.g.service = {'uri': 'https://owner-pilot-hash.a.run.app', 'urls': [setup.ORIGIN]}
        r = self.run_flow()
        self.assertEqual(r['status'], 'OAUTH_CREDENTIALS_STAGED')

    def test_rejects_mismatched_existing_service(self):
        self.g.service = {'urls': ['https://another-service.example']}
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'EXISTING_SERVICE_ORIGIN_MISMATCH')
        self.assertEqual(self.g.writes, [])

    def test_rejects_disabled_service_url(self):
        self.g.service = {'urls': [setup.ORIGIN], 'defaultUriDisabled': True}
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'EXISTING_SERVICE_ORIGIN_MISMATCH')

    def test_auth_failure_identifies_phase_without_exception_text(self):
        def fail():
            raise RuntimeError('secret-value-from-auth-provider')
        r = self.run_flow(authenticate=fail)
        self.assertEqual(r['stop_code'], 'GOOGLE_AUTHENTICATION_FAILED')
        self.assertEqual(r['stop_stage'], 'GOOGLE_AUTHENTICATION')
        self.assertNotIn('secret-value', json.dumps(r))
        self.assertEqual(self.g.reads, [])

    def test_upload_failure_is_distinct_from_auth_failure(self):
        def fail():
            raise RuntimeError('private-filename-client-secret')
        r = self.run_flow(upload=fail)
        self.assertEqual(r['stop_code'], 'OAUTH_UPLOAD_FAILED')
        self.assertEqual(r['stop_stage'], 'OAUTH_FILE_SELECTION')
        self.assertEqual(r['cloud_mutations_attempted'], 0)
        self.assertNotIn('private-filename', json.dumps(r))

    def test_interruption_preserves_phase_and_reports_no_success(self):
        def stop():
            raise KeyboardInterrupt()
        r = self.run_flow(upload=stop)
        self.assertEqual(r['stop_code'], 'SETUP_CANCELLED')
        self.assertEqual(r['stop_stage'], 'OAUTH_FILE_SELECTION')
        self.assertEqual(self.g.writes, [])

    def test_mid_write_failure_tracks_attempts_and_can_resume(self):
        self.g.fail_at = 2
        r = self.run_flow()
        self.assertEqual(r['stop_stage'], 'SECRET_STAGING')
        self.assertEqual(r['cloud_mutations_attempted'], 2)
        self.assertNotIn('synthetic failure', json.dumps(r))
        self.assertIsNone(self.g.prepared)
        stored = self.g.stored
        self.g = MemoryGoogle()
        self.g.stored = stored
        r = self.run_flow()
        self.assertEqual(r['status'], 'OAUTH_CREDENTIALS_STAGED')
        self.assertEqual(len(self.g.stored), 2)

    def test_arbitrary_secret_route_is_rejected_before_http(self):
        self.g.identify()
        with self.assertRaisesRegex(setup.Stop, 'READ_ROUTE_REJECTED'):
            self.g.read(setup.SM + '/unrelated-secret/versions/1:access')

    def test_unauthenticated_secret_read_is_rejected(self):
        with self.assertRaisesRegex(setup.Stop, 'OWNER_VERIFICATION_REQUIRED'):
            self.g.read(setup.SM + '/' + setup.SECRET_ID)

    def test_empty_configuration_is_not_guessed(self):
        with self.assertRaisesRegex(setup.Stop, 'SETUP_PROJECT_REQUIRED'):
            setup.configure(project='', number='', owner='', region='', service='')

    def test_http_reason_is_allowlisted_and_message_is_not_recorded(self):
        class Http:
            def request(self, *args, **kwargs):
                return SimpleNamespace(status_code=403, json=lambda: {
                    'error': {'status': 'PERMISSION_DENIED', 'message': 'private-value',
                              'details': [{'reason': 'private-value'}]}})
        g = setup.Google(SimpleNamespace(valid=True, token='fake-only'), Http(), None)
        with self.assertRaisesRegex(setup.Stop, 'GOOGLE_HTTP_403'):
            g.identify()
        self.assertEqual(g.last_reason, 'PERMISSION_DENIED')

    def test_changed_stored_payload_does_not_match_metadata(self):
        self.seed()
        self.g.stored[setup.SECRET_VALUE]['data'] = b'different-secret-value-0123456'
        r = self.run_flow()
        self.assertEqual(r['stop_code'], 'EXISTING_SECRET_CONFLICT')
        self.assertEqual(self.g.writes, [])


if __name__ == '__main__':
    unittest.main()
