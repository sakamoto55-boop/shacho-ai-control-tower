#!/usr/bin/env python3
"""DIOS read-only Google Cloud preflight. No deployment, API enablement or IAM writes.

Only contacts fixed Google APIs. Uses the active gcloud identity in this Cloud
Shell session. Tokens, raw errors, billing account IDs, service configuration,
secret values and database connection details are never printed or uploaded.
Run --self-test for offline tests; this does not access gcloud or Google.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from urllib import error, parse, request

VERSION = "1.0"
SERVICES = (
    "run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "iam.googleapis.com",
)
PERMISSIONS = (
    "serviceusage.services.enable", "run.services.create", "run.services.update",
    "cloudsql.instances.create", "secretmanager.secrets.create",
    "artifactregistry.repositories.create", "cloudbuild.builds.create",
    "iam.serviceAccounts.create", "iam.serviceAccounts.actAs",
)
SAFE_HOSTS = frozenset(("cloudresourcemanager.googleapis.com", "cloudbilling.googleapis.com",
                        "serviceusage.googleapis.com", "run.googleapis.com", "sqladmin.googleapis.com"))
ERROR_CODES = frozenset(("AUTH_REQUIRED", "HTTP_400", "HTTP_401", "HTTP_403", "HTTP_404",
                        "HTTP_429", "HTTP_ERROR", "API_DISABLED", "NETWORK_ERROR",
                        "INVALID_RESPONSE", "TIMEOUT", "GCLOUD_MISSING"))


class CheckError(Exception):
    def __init__(self, code: str):
        super().__init__(code if code in ERROR_CODES else "INVALID_RESPONSE")


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GoogleReader:
    def __init__(self, token: str):
        self._token = token
        self._opener = request.build_opener(NoRedirect())

    def __call__(self, host: str, path: str, query=None, body=None) -> dict:
        # POST is restricted to the non-mutating permission-test method.
        if host not in SAFE_HOSTS or not path.startswith("/"):
            raise CheckError("INVALID_RESPONSE")
        if body is not None and not (
            host == "cloudresourcemanager.googleapis.com"
            and re.fullmatch(r"/v1/projects/[a-z][a-z0-9-]{4,28}[a-z0-9]:testIamPermissions", path)
            and body == {"permissions": list(PERMISSIONS)}
        ):
            raise CheckError("INVALID_RESPONSE")
        url = "https://" + host + path + (("?" + parse.urlencode(query)) if query else "")
        data = json.dumps(body).encode() if body is not None else None
        req = request.Request(url, data=data, method="POST" if data is not None else "GET",
                              headers={"Authorization": "Bearer " + self._token,
                                       "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with self._opener.open(req, timeout=15) as res:
                raw = res.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise CheckError("INVALID_RESPONSE")
                parsed = json.loads(raw)
                if not isinstance(parsed, dict):
                    raise CheckError("INVALID_RESPONSE")
                return parsed
        except error.HTTPError as exc:
            # Inspect only a machine reason. Never echo an upstream response/error.
            code = f"HTTP_{exc.code}" if exc.code in (400, 401, 403, 404, 429) else "HTTP_ERROR"
            try:
                data = json.loads(exc.read(65536))
                details = data.get("error", {}).get("details", [])
                if any(isinstance(x, dict) and x.get("reason") == "SERVICE_DISABLED" for x in details):
                    code = "API_DISABLED"
            except (ValueError, TypeError, AttributeError):
                pass
            raise CheckError(code) from None
        except (error.URLError, OSError, TimeoutError):
            raise CheckError("NETWORK_ERROR") from None
        except (ValueError, TypeError):
            raise CheckError("INVALID_RESPONSE") from None


def active_token() -> str:
    env = os.environ.copy()
    # Avoid SDK debug/HTTP logging. Suppress raw stdout/stderr, except captured token.
    env["CLOUDSDK_CORE_LOG_HTTP"] = "false"
    env["CLOUDSDK_CORE_VERBOSITY"] = "error"
    try:
        res = subprocess.run(["gcloud", "auth", "print-access-token", "--quiet", "--verbosity=error"],
                             capture_output=True, text=True, timeout=180, env=env, check=False)
    except FileNotFoundError:
        raise CheckError("GCLOUD_MISSING") from None
    except subprocess.TimeoutExpired:
        raise CheckError("TIMEOUT") from None
    token = res.stdout.strip()
    if res.returncode != 0 or not token or any(c.isspace() for c in token):
        raise CheckError("AUTH_REQUIRED")
    return token


def collect(project: str, expected_number: str, read) -> dict:
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) or not re.fullmatch(r"[0-9]{1,20}", expected_number):
        raise ValueError("Project ID or expected number is invalid")
    report = {"version": VERSION, "as_of": datetime.now(timezone.utc).isoformat(),
              "project_id": project, "expected_number": expected_number, "project_verified": False,
              "settings_changed": False, "deployed": False, "errors": {}}
    try:
        info = read("cloudresourcemanager.googleapis.com", f"/v1/projects/{project}")
        if info.get("projectId") != project or str(info.get("projectNumber", "")) != expected_number:
            report["errors"]["project"] = "PROJECT_MISMATCH"
            return report
        if info.get("lifecycleState") != "ACTIVE":
            report["errors"]["project"] = "PROJECT_NOT_ACTIVE"
            return report
        report["project_verified"] = True
    except CheckError as exc:
        report["errors"]["project"] = str(exc)
        return report
    try:
        billing = read("cloudbilling.googleapis.com", f"/v1/projects/{project}/billingInfo")
        # Cloud Billing omits a false proto3 boolean. Only a matching billingInfo
        # envelope makes omission a trustworthy false; malformed payload is unknown.
        if billing.get("projectId") != project or billing.get("name") != f"projects/{project}/billingInfo":
            raise CheckError("INVALID_RESPONSE")
        enabled = billing.get("billingEnabled", False)
        if type(enabled) is not bool:
            raise CheckError("INVALID_RESPONSE")
        report["billing_enabled"] = enabled
    except CheckError as exc:
        report["billing_enabled"] = None
        report["errors"]["billing"] = str(exc)
    try:
        iam = read("cloudresourcemanager.googleapis.com", f"/v1/projects/{project}:testIamPermissions",
                   body={"permissions": list(PERMISSIONS)})
        granted = iam.get("permissions", [])
        if not isinstance(granted, list) or not all(isinstance(x, str) for x in granted):
            raise CheckError("INVALID_RESPONSE")
        report["permissions_granted"] = [p for p in PERMISSIONS if p in granted]
        report["permissions_not_returned"] = [p for p in PERMISSIONS if p not in granted]
    except CheckError as exc:
        report["permissions_granted"] = None
        report["permissions_not_returned"] = None
        report["errors"]["permissions"] = str(exc)
    try:
        enabled, cursor, complete = set(), None, False
        for _ in range(5):
            params = {"filter": "state:ENABLED", "pageSize": 200}
            if cursor:
                params["pageToken"] = cursor
            page = read("serviceusage.googleapis.com", f"/v1/projects/{expected_number}/services", query=params)
            entries = page.get("services", [])
            if not isinstance(entries, list):
                raise CheckError("INVALID_RESPONSE")
            for entry in entries:
                if not isinstance(entry, dict) or entry.get("state") != "ENABLED":
                    raise CheckError("INVALID_RESPONSE")
                config = entry.get("config", {})
                if not isinstance(config, dict) or not isinstance(config.get("name"), str):
                    raise CheckError("INVALID_RESPONSE")
                enabled.add(config["name"])
            cursor = page.get("nextPageToken")
            if cursor is not None and not isinstance(cursor, str):
                raise CheckError("INVALID_RESPONSE")
            if not cursor:
                complete = True
                break
        report["services"] = {name: True if name in enabled else (False if complete else None) for name in SERVICES}
        if not complete:
            report["errors"]["services"] = "PARTIAL_LIST"
    except CheckError as exc:
        report["services"] = {name: None for name in SERVICES}
        report["errors"]["services"] = str(exc)
    # No endpoint is automatically enabled just to list resources. Emit counts
    # only: no URIs, labels, connection names, user names or configuration.
    for key, api, host, path, field in (
        ("run_tokyo", "run.googleapis.com", "run.googleapis.com", f"/v2/projects/{project}/locations/asia-northeast1/services", "services"),
        ("sql", "sqladmin.googleapis.com", "sqladmin.googleapis.com", f"/sql/v1beta4/projects/{project}/instances", "items"),
    ):
        report[key] = None
        if report["services"].get(api) is not True:
            report["errors"][key] = "API_NOT_CONFIRMED_ENABLED"
            continue
        try:
            page = read(host, path)
            entries = page.get(field, [])
            if not isinstance(entries, list):
                raise CheckError("INVALID_RESPONSE")
            report[key] = {"count": len(entries), "complete": not bool(page.get("nextPageToken"))}
        except CheckError as exc:
            report["errors"][key] = str(exc)
    return report


def display(report: dict) -> str:
    # A small screenshot-friendly summary, followed by optional complete JSON.
    errors = report["errors"]
    def count(key):
        value = report.get(key)
        if value is None:
            return "未確認 / " + errors.get(key, "UNKNOWN")
        return str(value["count"]) + ("件" if value["complete"] else "件以上（一覧の一部）")
    lines = ["=== DIOS 確認結果（読取のみ） ===", "対象: " + report["project_id"],
             "番号照合: " + ("一致" if report["project_verified"] else "未確認 / " + errors.get("project", "UNKNOWN"))]
    if report["project_verified"]:
        b = report.get("billing_enabled")
        lines.append("課金の有効化: " + ("有効" if b is True else "無効" if b is False else "未確認 / " + errors.get("billing", "UNKNOWN")))
        permissions = report.get("permissions_granted")
        lines.append("設定権限（候補9種）: " + (f"{len(permissions)}/9確認" if permissions is not None else "未確認 / " + errors.get("permissions", "UNKNOWN")))
        if report.get("permissions_not_returned"):
            lines.extend("  未確認: " + x for x in report["permissions_not_returned"])
        services = report["services"]
        lines.append("必要API（候補6種）: " + f"{sum(x is True for x in services.values())}/6有効")
        lines.append("未有効/未確認: " + (", ".join(k.split('.')[0]+("?" if v is None else "") for k,v in services.items() if v is not True) or "なし"))
        lines.extend(["既存Cloud Run（東京）: " + count("run_tokyo"), "既存Cloud SQL: " + count("sql")])
    lines.extend(["設定変更: なし / 本番公開: 未実施", "※権限の確認と、費用・公開の承認は別です。", "=== この結果をチャットに送ってください ==="])
    return "\n".join(lines)


def self_test() -> int:
    import unittest
    from unittest.mock import patch
    project, number = "sample-project", "123456789012"
    class Reader:
        def __init__(self, **changes):
            self.changes, self.calls = changes, []
        def __call__(self, host, path, query=None, body=None):
            self.calls.append((host, path, query, body))
            key = "project" if host.startswith("cloudresourcemanager") and body is None else "permissions" if body else "billing" if host.startswith("cloudbilling") else "services" if host.startswith("serviceusage") else "resources"
            defaults = {
                "project": {"projectId":project,"projectNumber":number,"lifecycleState":"ACTIVE"},
                "permissions": {"permissions":list(PERMISSIONS)},
                "billing": {"name":f"projects/{project}/billingInfo","projectId":project,"billingEnabled":True,"billingAccountName":"NEVER_PRINT_ME"},
                "services": {"services":[{"state":"ENABLED","config":{"name":x}} for x in SERVICES]},
                "resources": {},
            }
            result = self.changes.get(key, defaults[key])
            if isinstance(result, Exception):
                raise result
            return result
    class Checks(unittest.TestCase):
        def test_read_only_calls(self):
            rd=Reader(); r=collect(project,number,rd)
            self.assertTrue(r["project_verified"])
            self.assertFalse(r["settings_changed"])
            self.assertEqual(len(rd.calls),6)
            self.assertEqual([c[1] for c in rd.calls if c[3] is not None],[f"/v1/projects/{project}:testIamPermissions"])
        def test_mismatch_stops(self):
            rd=Reader(project={"projectId":project,"projectNumber":"1"})
            self.assertFalse(collect(project,number,rd)["project_verified"])
            self.assertEqual(len(rd.calls),1)
        def test_project_forbidden_stops(self):
            rd=Reader(project=CheckError("HTTP_403"))
            self.assertIn("HTTP_403", display(collect(project,number,rd)))
            self.assertEqual(len(rd.calls),1)
        def test_billing_failure_unknown(self):
            r=collect(project,number,Reader(billing=CheckError("HTTP_403")))
            self.assertIsNone(r["billing_enabled"])
        def test_omitted_false_billing(self):
            r=collect(project,number,Reader(billing={"name":f"projects/{project}/billingInfo","projectId":project}))
            self.assertIs(r["billing_enabled"],False)
        def test_invalid_billing_unknown(self):
            self.assertIsNone(collect(project,number,Reader(billing={}))["billing_enabled"])
        def test_denied_vs_unknown_permissions(self):
            self.assertEqual(collect(project,number,Reader(permissions={}))["permissions_granted"],[])
            self.assertIsNone(collect(project,number,Reader(permissions=CheckError("HTTP_403")))["permissions_granted"])
        def test_no_identifiers_from_billing_or_resources(self):
            r=collect(project,number,Reader(resources={"items":[{"connectionName":"NEVER_PRINT_ME","ipAddresses":["NEVER_PRINT_ME"]}]}))
            self.assertNotIn("NEVER_PRINT_ME",json.dumps(r)+display(r))
        def test_no_calls_to_disabled_apis(self):
            rd=Reader(services={});r=collect(project,number,rd)
            self.assertEqual(len(rd.calls),4)
            self.assertIsNone(r["sql"])
        def test_partial_api_list_unknown_not_false(self):
            rd=Reader(services={"services":[],"nextPageToken":"repeat"})
            r=collect(project,number,rd)
            self.assertTrue(all(v is None for v in r["services"].values()))
            self.assertEqual(r["errors"]["services"],"PARTIAL_LIST")
        def test_resource_pagination_not_complete(self):
            r=collect(project,number,Reader(resources={"items":[{}],"nextPageToken":"more"}))
            self.assertFalse(r["sql"]["complete"])
        def test_no_mutating_post_or_unknown_host(self):
            g=GoogleReader("test-token")
            with self.assertRaises(CheckError):g("cloudresourcemanager.googleapis.com",f"/v1/projects/{project}",body={"permissions":list(PERMISSIONS)})
            with self.assertRaises(CheckError):g("evil.example.com","/test")
        def test_token_never_echoed_on_error(self):
            with patch("subprocess.run",return_value=subprocess.CompletedProcess([],1,stdout="SECRET_TEST_TOKEN",stderr="SECRET_TEST_TOKEN")):
                with self.assertRaises(CheckError) as result:active_token()
                self.assertEqual(str(result.exception),"AUTH_REQUIRED")
        def test_project_injection_rejected(self):
            with self.assertRaises(ValueError):collect("sample/../../other",number,Reader())
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Checks)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project")
    parser.add_argument("--expected-number")
    parser.add_argument("--json",action="store_true",help="Print full sanitized report instead of summary")
    parser.add_argument("--self-test",action="store_true",help="Offline tests; no authentication or cloud requests")
    args=parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.project or not args.expected_number:
        parser.error("--project and --expected-number are required")
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]",args.project) or not re.fullmatch(r"[0-9]{1,20}",args.expected_number):
        parser.error("Invalid project identifier")
    print("DIOS: 読取確認を開始します。GoogleからCloud Shellの承認が出たら確認してください。",flush=True)
    try:
        report=collect(args.project,args.expected_number,GoogleReader(active_token()))
        print(json.dumps(report,ensure_ascii=False,indent=2) if args.json else display(report),flush=True)
        return 0 if report["project_verified"] else 2
    except CheckError as exc:
        print("DIOS: 確認できませんでした / "+str(exc)+"\n設定変更はしていません。認証文字列は送らず、この表示だけ送ってください。")
        return 2
    except KeyboardInterrupt:
        print("\nDIOS: 確認を中止しました。設定変更はしていません。")
        return 130
    except Exception:
        print("DIOS: 確認処理を完了できませんでした / UNEXPECTED_ERROR\n設定変更はしていません。")
        return 2

if __name__=="__main__":
    sys.exit(main())
