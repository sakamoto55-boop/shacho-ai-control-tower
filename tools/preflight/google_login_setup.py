#@title ▶ ③ DIOSのGoogleログイン情報を登録
"""Owner-only credential staging. Does not deploy DIOS or grant IAM permissions.

Runs in the owner's Google Colab, not in the assistant environment. The input
is the Web OAuth JSON saved when the existing secret was created. Google does
not allow later re-download of the secret. No credential values are logged.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import uuid
from datetime import datetime, timezone

# Target identity is supplied by the private notebook or environment, never inferred.
PROJECT = NUMBER = REGION = OWNER = SERVICE = ORIGIN = CALLBACK = ''
SOURCE_HEAD = None
EXPECTED_CLIENT_ID = None
IDENTITY = 'https://openidconnect.googleapis.com/v1/userinfo'
CRM = RUN = SM = ''
SECRET_ID = 'dios-owner-google-client-id'
SECRET_VALUE = 'dios-owner-google-client-secret'
NAMES = (SECRET_ID, SECRET_VALUE)
REPLICATION = {}
VERSION = '3.3-existing-client-binding'


class Stop(Exception):
    def __init__(self, code):
        super().__init__(code if isinstance(code, str) and re.fullmatch(r'[A-Z0-9_]{1,100}', code) else 'SAFE_STOP')


def require(ok, code):
    if not ok:
        raise Stop(code)


def configure(*, project, number, owner, region, service, source_head=None, expected_client_id=None):
    """Bind the operator's exact target before authentication or API calls."""
    require(bool(re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project)), 'SETUP_PROJECT_REQUIRED')
    require(bool(re.fullmatch(r'[0-9]{6,20}', number)), 'SETUP_PROJECT_NUMBER_REQUIRED')
    require(bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', owner)), 'SETUP_OWNER_REQUIRED')
    require(bool(re.fullmatch(r'[a-z]+-[a-z]+[0-9]', region)), 'SETUP_REGION_REQUIRED')
    require(bool(re.fullmatch(r'[a-z][a-z0-9-]{0,47}[a-z0-9]', service)), 'SETUP_SERVICE_REQUIRED')
    require(source_head is None or (isinstance(source_head, str)
            and bool(re.fullmatch(r'[0-9a-f]{40}', source_head))), 'SETUP_SOURCE_HEAD_INVALID')
    require(expected_client_id is None or (isinstance(expected_client_id, str)
            and bool(re.fullmatch(number + r'-[a-zA-Z0-9_-]{5,200}\.apps\.googleusercontent\.com', expected_client_id))),
            'SETUP_EXPECTED_CLIENT_INVALID')
    global PROJECT, NUMBER, OWNER, REGION, SERVICE, ORIGIN, CALLBACK, CRM, RUN, SM, REPLICATION, SOURCE_HEAD, EXPECTED_CLIENT_ID
    PROJECT, NUMBER, OWNER, REGION, SERVICE = project, number, owner.lower(), region, service
    # Metadata from the caller, not proof that these bytes or a deployment match it.
    # Omission clears a previous notebook execution's provenance instead of reusing it.
    SOURCE_HEAD = source_head
    EXPECTED_CLIENT_ID = expected_client_id
    ORIGIN = 'https://' + service + '-' + number + '.' + region + '.run.app'
    CALLBACK = ORIGIN + '/dios/auth/callback'
    CRM = 'https://cloudresourcemanager.googleapis.com/v1/projects/' + PROJECT
    RUN = 'https://run.googleapis.com/v2/projects/' + PROJECT + '/locations/' + REGION + '/services/' + SERVICE
    SM = 'https://secretmanager.googleapis.com/v1/projects/' + NUMBER + '/secrets'
    REPLICATION = {'userManaged': {'replicas': [{'location': REGION}]}}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def crc32c(data):
    value = 0xffffffff
    for byte in data:
        value ^= byte
        for _ in range(8):
            value = (value >> 1) ^ (0x82f63b78 if value & 1 else 0)
    return value ^ 0xffffffff


def reject_duplicate_keys(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'DUPLICATE_JSON_KEY')
        out[key] = value
    return out


def validate_client(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 32768, 'OAUTH_FILE_SIZE_INVALID')
    try:
        obj = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=reject_duplicate_keys)
    except Stop:
        raise
    except Exception:
        raise Stop('OAUTH_JSON_INVALID') from None
    require(isinstance(obj, dict) and set(obj) == {'web'}, 'WEB_APPLICATION_JSON_REQUIRED')
    web = obj['web']
    require(isinstance(web, dict), 'WEB_APPLICATION_JSON_REQUIRED')
    require(web.get('project_id') == PROJECT, 'OAUTH_PROJECT_MISMATCH')
    client_id, client_secret = web.get('client_id'), web.get('client_secret')
    require(isinstance(client_id, str) and bool(re.fullmatch(NUMBER + r'-[a-zA-Z0-9_-]{5,200}\.apps\.googleusercontent\.com', client_id)), 'CLIENT_ID_INVALID')
    require(EXPECTED_CLIENT_ID is None or client_id == EXPECTED_CLIENT_ID, 'OAUTH_CLIENT_MISMATCH')
    require(isinstance(client_secret, str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{16,256}', client_secret)), 'CLIENT_SECRET_INVALID')
    require(web.get('auth_uri') in ('https://accounts.google.com/o/oauth2/auth', 'https://accounts.google.com/o/oauth2/v2/auth'), 'AUTH_ENDPOINT_INVALID')
    require(web.get('token_uri') == 'https://oauth2.googleapis.com/token', 'TOKEN_ENDPOINT_INVALID')
    require(web.get('redirect_uris') == [CALLBACK], 'REDIRECT_URI_MISMATCH')
    require(web.get('javascript_origins', []) in ([], [ORIGIN]), 'JAVASCRIPT_ORIGIN_MISMATCH')
    allowed = {'client_id','project_id','auth_uri','token_uri','auth_provider_x509_cert_url','client_secret','redirect_uris','javascript_origins'}
    require(not set(web) - allowed, 'UNEXPECTED_OAUTH_FIELD')
    if 'auth_provider_x509_cert_url' in web:
        require(web['auth_provider_x509_cert_url'] == 'https://www.googleapis.com/oauth2/v1/certs', 'CERT_ENDPOINT_INVALID')
    return {SECRET_ID: client_id.encode(), SECRET_VALUE: client_secret.encode()}


def labels(data):
    digest = hashlib.sha256(data).hexdigest()
    return {'dios_module': 'owner-oauth-v1', 'payload_sha_a': digest[:32], 'payload_sha_b': digest[32:]}


def safe_version_name(value, secret_name):
    prefix = 'projects/' + NUMBER + '/secrets/' + secret_name + '/versions/'
    return isinstance(value, str) and value.startswith(prefix) and bool(re.fullmatch(r'[1-9][0-9]{0,9}', value[len(prefix):]))


class Google:
    def __init__(self, credentials, http, refresh_request):
        self.credentials, self.http, self.refresh_request = credentials, http, refresh_request
        self.owner_verified = False
        self.mutations = 0
        self.prepared = None
        self.last_reason = 'UNKNOWN'

    def _request(self, method, url, body=None, params=None, missing=False):
        # Redirects are refused so bearer credentials never follow another host.
        try:
            if not self.credentials.valid:
                self.credentials.refresh(self.refresh_request())
            headers = {'Authorization': 'Bearer ' + self.credentials.token}
            if url != IDENTITY:
                headers['x-goog-user-project'] = PROJECT
            r = self.http.request(method, url, headers=headers, json=body, params=params,
                                  timeout=45, allow_redirects=False)
        except Exception:
            raise Stop('GOOGLE_CONNECTION_FAILED') from None
        if r.status_code == 404 and missing:
            return None
        if not 200 <= r.status_code < 300:
            # Do not print Google's free-form error message: it can contain identifiers.
            safe_reasons = {'SERVICE_DISABLED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
                            'IAM_PERMISSION_DENIED', 'USER_PROJECT_DENIED', 'PERMISSION_DENIED',
                            'NOT_FOUND', 'INVALID_ARGUMENT', 'RESOURCE_EXHAUSTED'}
            try:
                error = r.json().get('error', {})
                candidates = [error.get('status')] + [x.get('reason') for x in error.get('details', []) if isinstance(x, dict)]
                self.last_reason = next((x for x in candidates if x in safe_reasons), 'UNKNOWN')
            except Exception:
                self.last_reason = 'UNKNOWN'
            raise Stop('GOOGLE_HTTP_' + str(r.status_code))
        try:
            result = r.json()
        except Exception:
            raise Stop('GOOGLE_RESPONSE_INVALID') from None
        require(isinstance(result, dict), 'GOOGLE_RESPONSE_INVALID')
        return result

    def read(self, url, missing=False):
        if url not in (IDENTITY, CRM):
            require(self.owner_verified, 'OWNER_VERIFICATION_REQUIRED')
        allowed = url in (IDENTITY, CRM, RUN)
        for name in NAMES:
            root = SM + '/' + name
            allowed = allowed or url in (root, root + '/versions')
            allowed = allowed or bool(re.fullmatch(re.escape(root) + r'/versions/[1-9][0-9]{0,9}:access', url))
        require(allowed, 'READ_ROUTE_REJECTED')
        return self._request('GET', url, missing=missing)

    def identify(self):
        who = self.read(IDENTITY)
        require(who.get('email_verified') is True and who.get('email', '').strip().lower() == OWNER
                and isinstance(who.get('sub'), str) and bool(who['sub']), 'WRONG_GOOGLE_ACCOUNT')
        project = self.read(CRM)
        require(project.get('projectId') == PROJECT and str(project.get('projectNumber')) == NUMBER
                and project.get('lifecycleState') == 'ACTIVE', 'GOOGLE_PROJECT_MISMATCH')
        self.owner_verified = True

    def prepare(self, data):
        require(self.owner_verified, 'OWNER_VERIFICATION_REQUIRED')
        # Only a validated Web client can reach write methods.
        require(isinstance(data, dict) and set(data) == set(NAMES), 'PREPARED_VALUES_INVALID')
        require(all(isinstance(data[n], bytes) and 16 <= len(data[n]) <= 512 for n in NAMES), 'PREPARED_VALUES_INVALID')
        self.prepared = dict(data)

    def create(self, name):
        require(self.owner_verified and self.prepared is not None and name in NAMES, 'WRITE_NOT_PREPARED')
        require(self.mutations < 4, 'MUTATION_LIMIT_REACHED')
        self.mutations += 1
        return self._request('POST', SM, params={'secretId': name},
                             body={'replication': REPLICATION, 'labels': labels(self.prepared[name])})

    def add(self, name):
        require(self.owner_verified and self.prepared is not None and name in NAMES, 'WRITE_NOT_PREPARED')
        require(self.mutations < 4, 'MUTATION_LIMIT_REACHED')
        raw = self.prepared[name]
        self.mutations += 1
        return self._request('POST', SM + '/' + name + ':addVersion', body={
            'payload': {'data': base64.b64encode(raw).decode(), 'dataCrc32c': str(crc32c(raw))}})


def versions(g, name):
    result = g.read(SM + '/' + name + '/versions')
    rows = result.get('versions', [])
    require(not result.get('nextPageToken'), 'EXISTING_SECRET_NEEDS_REVIEW')
    require(isinstance(rows, list) and len(rows) <= 1, 'EXISTING_SECRET_NEEDS_REVIEW')
    for row in rows:
        require(isinstance(row, dict) and safe_version_name(row.get('name'), name)
                and row.get('state') == 'ENABLED', 'SECRET_VERSION_INVALID')
    return rows


def read_payload(g, name, version):
    require(safe_version_name(version, name), 'SECRET_VERSION_INVALID')
    value = g.read('https://secretmanager.googleapis.com/v1/' + version + ':access')
    require(value.get('name') == version, 'SECRET_READBACK_NAME_MISMATCH')
    payload = value.get('payload', {})
    try:
        data = base64.b64decode(payload['data'], validate=True)
        checksum = int(payload['dataCrc32c'])
    except Exception:
        raise Stop('SECRET_READBACK_INVALID') from None
    require(16 <= len(data) <= 512 and crc32c(data) == checksum, 'SECRET_READBACK_MISMATCH')
    return data


def verify_payload(g, name, version, expected):
    require(hmac.compare_digest(read_payload(g, name, version), expected), 'SECRET_READBACK_MISMATCH')


def check_service(g, receipt):
    service = g.read(RUN, missing=True)
    if service:
        urls = service.get('urls', [])
        require(isinstance(urls, list), 'EXISTING_SERVICE_ORIGIN_MISMATCH')
        # Cloud Run v2 can expose both the deterministic and hash-based URLs.
        require((service.get('uri') == ORIGIN or ORIGIN in urls)
                and not service.get('defaultUriDisabled', False), 'EXISTING_SERVICE_ORIGIN_MISMATCH')
    receipt['existing_service_origin_matches'] = bool(service)


def resume_existing(g, receipt):
    """Read and validate both stored values without changing credentials or IAM."""
    require(g.owner_verified, 'OWNER_VERIFICATION_REQUIRED')
    values, references, incomplete = {}, [], False
    for name in NAMES:
        metadata = g.read(SM + '/' + name, missing=True)
        if metadata is None:
            incomplete = True
            continue
        require(metadata.get('name') == 'projects/' + NUMBER + '/secrets/' + name, 'SECRET_RESOURCE_MISMATCH')
        require(metadata.get('labels', {}).get('dios_module') == 'owner-oauth-v1', 'EXISTING_SECRET_CONFLICT')
        require(metadata.get('replication') == REPLICATION, 'SECRET_REPLICATION_MISMATCH')
        rows = versions(g, name)
        if not rows:
            incomplete = True
            continue
        data = read_payload(g, name, rows[0]['name'])
        require(all(metadata.get('labels', {}).get(k) == v for k, v in labels(data).items()), 'EXISTING_SECRET_CONFLICT')
        values[name] = data
        references.append(rows[0]['name'])
    if incomplete:
        return False
    try:
        raw = json.dumps({'web': {'project_id': PROJECT,
            'client_id': values[SECRET_ID].decode(), 'client_secret': values[SECRET_VALUE].decode(),
            'auth_uri': 'https://accounts.google.com/o/oauth2/v2/auth',
            'token_uri': 'https://oauth2.googleapis.com/token', 'redirect_uris': [CALLBACK]}}).encode()
        validate_client(raw)
    except UnicodeError:
        raise Stop('SECRET_READBACK_INVALID') from None
    check_service(g, receipt)
    receipt.update(status='OAUTH_CREDENTIALS_STAGED', stored_secret_versions=references,
                   resumed_existing=True)
    # Local shape validation is not a fresh proof of the provider's OAuth configuration.
    return True


def inspect_existing(g, name, expected):
    metadata = g.read(SM + '/' + name, missing=True)
    if metadata is None:
        return None
    require(metadata.get('name') == 'projects/' + NUMBER + '/secrets/' + name, 'SECRET_RESOURCE_MISMATCH')
    require(all(metadata.get('labels', {}).get(k) == v for k, v in labels(expected).items()), 'EXISTING_SECRET_CONFLICT')
    require(metadata.get('replication') == REPLICATION, 'SECRET_REPLICATION_MISMATCH')
    rows = versions(g, name)
    if rows:
        verify_payload(g, name, rows[0]['name'], expected)
    return rows


def stage(g, raw, receipt):
    require(g.owner_verified, 'OWNER_VERIFICATION_REQUIRED')
    data = validate_client(raw)
    check_service(g, receipt)
    g.prepare(data)
    # Inspect both targets first; a conflicting second secret causes zero writes.
    existing = {name: inspect_existing(g, name, data[name]) for name in NAMES}
    for name in NAMES:
        rows = existing[name]
        if rows is None:
            created = g.create(name)
            require(created.get('name') == 'projects/' + NUMBER + '/secrets/' + name, 'SECRET_CREATE_NOT_CONFIRMED')
            rows = []
        if not rows:
            added = g.add(name)
            require(safe_version_name(added.get('name'), name) and added.get('state') == 'ENABLED', 'SECRET_ADD_NOT_CONFIRMED')
        rows = inspect_existing(g, name, data[name])
        require(rows is not None and len(rows) == 1, 'SECRET_VERSION_NOT_CONFIRMED')
        receipt['stored_secret_versions'].append(rows[0]['name'])
    receipt['status'] = 'OAUTH_CREDENTIALS_STAGED'
    return receipt


def new_receipt():
    return {'kind': 'DIOS_GOOGLE_LOGIN_SETUP', 'version': VERSION, 'started': stamp(),
            'status': 'NOT_STARTED', 'project': PROJECT, 'planned_callback': CALLBACK,
            'source_head': SOURCE_HEAD,
            'source_head_origin': 'operator_declared' if SOURCE_HEAD else 'unknown',
            'source_head_verified': False,
            'secret_values_in_receipt': False, 'iam_changes': 0, 'sql_changes': 0,
            'dios_deployed_by_this_step': False, 'actual_google_login_verified': False,
            'stored_secret_versions': [], 'cloud_mutations_attempted': 0,
            'resumed_existing': False, 'stage': 'NOT_STARTED', 'events': []}


def save_receipt(g, receipt):
    require(g.owner_verified, 'OWNER_VERIFICATION_REQUIRED')
    name = 'DIOS_GOOGLE_LOGIN_SETUP_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + uuid.uuid4().hex[:8] + '.json'
    boundary = 'dios_' + uuid.uuid4().hex
    body = ('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
            json.dumps({'name': name, 'mimeType': 'application/json'}) + '\r\n--' + boundary +
            '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
            json.dumps(receipt, ensure_ascii=False) + '\r\n--' + boundary + '--\r\n').encode()
    try:
        if not g.credentials.valid:
            g.credentials.refresh(g.refresh_request())
        result = g.http.request('POST', 'https://www.googleapis.com/upload/drive/v3/files',
            params={'uploadType': 'multipart', 'fields': 'id,name'}, data=body,
            headers={'Authorization': 'Bearer ' + g.credentials.token, 'Content-Type': 'multipart/related; boundary=' + boundary},
            timeout=45, allow_redirects=False)
        require(result.status_code in (200, 201), 'RECEIPT_SAVE_FAILED')
        item = result.json()
        require(item.get('name') == name and isinstance(item.get('id'), str)
                and bool(re.fullmatch(r'[A-Za-z0-9_-]{10,200}', item['id'])), 'RECEIPT_SAVE_FAILED')
        return name
    except Exception:
        raise Stop('RECEIPT_SAVE_FAILED') from None


STAGE_MESSAGES = {
    'GOOGLE_AUTHENTICATION': '1/5 会社Googleアカウントを確認します。',
    'OWNER_AND_PROJECT': '2/5 本人と配備先を照合します。',
    'EXISTING_CREDENTIALS': '3/5 登録済みのログイン情報を確認します。',
    'OAUTH_FILE_SELECTION': '4/5 Googleから取得したWebアプリのJSONを1つ選びます。',
    'SECRET_STAGING': '5/5 ログイン情報を登録・読み戻し確認します。',
}
STOP_MESSAGES = {
    'GOOGLE_AUTHENTICATION_FAILED': 'Google認証を完了できませんでした。会社アカウントで認証を完了して③を再実行してください。',
    'OAUTH_UPLOAD_FAILED': 'JSON選択を完了できませんでした。③を再実行し、Googleから取得したWebアプリのJSONを選んでください。',
    'SELECT_ONE_WEB_OAUTH_JSON': '選択されたファイルを確認できません。WebアプリのJSONを1つ選んでください。',
    'SETUP_CANCELLED': '操作を中断しました。登録済みの情報は削除していません。',
    'WRONG_GOOGLE_ACCOUNT': '会社アカウントの本人確認が一致しませんでした。',
    'EXISTING_SECRET_CONFLICT': '登録済み情報と一致しません。上書きせず停止しました。',
    'OAUTH_CLIENT_MISMATCH': '確認済みの既存OAuthクライアントと一致しません。新しいクライアントを作らず、対象のJSONを確認してください。',
}


def run_setup(authenticate, make_google, upload, notify=lambda _message: None):
    """Testable control flow; receipt never includes exception text or uploaded values."""
    receipt, g = new_receipt(), None
    def phase(name):
        receipt['stage'] = name
        receipt['events'].append({'stage': name, 'at': stamp()})
        notify(STAGE_MESSAGES[name])
    try:
        require(bool(PROJECT and OWNER and NUMBER and REGION and SERVICE), 'SETUP_TARGET_REQUIRED')
        phase('GOOGLE_AUTHENTICATION')
        authenticate()
        g = make_google()
        phase('OWNER_AND_PROJECT')
        g.identify()
        phase('EXISTING_CREDENTIALS')
        if not resume_existing(g, receipt):
            phase('OAUTH_FILE_SELECTION')
            raw = upload()
            try:
                phase('SECRET_STAGING')
                stage(g, raw, receipt)
            finally:
                raw = None
        receipt['stage'] = 'FINISHED'
    except KeyboardInterrupt:
        receipt['status'], receipt['stop_code'] = 'STOPPED', 'SETUP_CANCELLED'
    except Stop as exc:
        receipt['status'], receipt['stop_code'] = 'STOPPED', str(exc)
    except Exception:
        code = {'GOOGLE_AUTHENTICATION': 'GOOGLE_AUTHENTICATION_FAILED',
                'OAUTH_FILE_SELECTION': 'OAUTH_UPLOAD_FAILED'}.get(receipt['stage'], 'UNEXPECTED_SAFE_STOP')
        receipt['status'], receipt['stop_code'] = 'STOPPED', code
    finally:
        receipt['completed'] = stamp()
        if receipt['status'] == 'STOPPED':
            receipt['stop_stage'] = receipt['stage']
            receipt['stop_reason'] = getattr(g, 'last_reason', 'UNKNOWN')
        if g:
            receipt['cloud_mutations_attempted'] = g.mutations
            g.prepared = None
    return receipt, g


def launch():
    import inspect
    import tempfile
    print('登録済みのログイン情報が確認できれば、JSONの再選択は不要です。')
    print('初回のみDIOS専用のログイン情報2点をSecret Managerへ保存します。')
    print('JSONは既存OAuthの秘密鍵を作成した時に保存したものを使います。秘密鍵の再ダウンロードはできません。')
    print('手元にない場合は選択を中止してください。再発行は既存利用への影響を確認し、本人の判断で行います。')
    def authenticate():
        from google.colab import auth
        auth.authenticate_user()
    def make_google():
        import google.auth
        import requests
        from google.auth.transport.requests import Request
        credentials, _ = google.auth.default()
        return Google(credentials, requests, Request)
    def upload():
        from google.colab import files
        require('target_dir' in inspect.signature(files.upload).parameters, 'COLAB_UPLOAD_API_UNSUPPORTED')
        with tempfile.TemporaryDirectory(prefix='dios_oauth_') as private_dir:
            uploaded = files.upload(target_dir=private_dir)
            try:
                require(isinstance(uploaded, dict) and len(uploaded) == 1, 'SELECT_ONE_WEB_OAUTH_JSON')
                raw = next(iter(uploaded.values()))
                require(isinstance(raw, (bytes, bytearray)), 'OAUTH_FILE_SIZE_INVALID')
                return bytes(raw)
            finally:
                if isinstance(uploaded, dict):
                    uploaded.clear()
    receipt, g = run_setup(authenticate, make_google, upload, print)
    if g and g.owner_verified:
        try:
            print('結果ファイル: ' + save_receipt(g, receipt))
        except Stop:
            print('結果ファイルの自動保存を確認できませんでした。下の状態だけお知らせください。')
    if receipt['status'] == 'OAUTH_CREDENTIALS_STAGED':
        print('登録済み情報を読み戻して確認しました。' if receipt['resumed_existing'] else 'ログイン情報の登録完了。')
        print('本体の配備・実ログイン確認は未完了です。')
        print('このチャットへ「③の登録が終わった」と返信してください。JSONや秘密の値の貼り付けは不要です。')
    else:
        print('停止コード: ' + receipt.get('stop_code', 'SAFE_STOP'))
        print('停止箇所: ' + receipt.get('stop_stage', 'NOT_STARTED'))
        print(STOP_MESSAGES.get(receipt.get('stop_code'), '設定を変更せず停止しました。停止コードと停止箇所から確認します。'))
        print('成功とは判定していません。停止コードだけお知らせください。')


if __name__ == '__main__':
    import os
    configure(project=os.environ.get('DIOS_SETUP_PROJECT', ''),
              number=os.environ.get('DIOS_SETUP_PROJECT_NUMBER', ''),
              owner=os.environ.get('DIOS_SETUP_OWNER_EMAIL', ''),
              region=os.environ.get('DIOS_SETUP_REGION', ''),
              service=os.environ.get('DIOS_SETUP_SERVICE', ''),
              source_head=os.environ.get('DIOS_SETUP_SOURCE_HEAD') or None,
              expected_client_id=os.environ.get('DIOS_SETUP_EXPECTED_CLIENT_ID') or None)
    launch()
