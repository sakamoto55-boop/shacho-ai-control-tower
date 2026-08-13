/**
 * 端末ペアリング（iPhone接続）: 6桁コード→HttpOnlyセッション発行。
 *
 * - 通常導線からURLの?token=手入力を廃止するための仕組み（既存token認証は互換維持）。
 * - コードは5分有効・1回限り・試行5回まで・LAN(プライベートIP)からのみ受理。
 * - CODEX是正3: 静的Bearer tokenを平文保存しない。保存はsidHash・Principal最小情報
 *   （role/companyIds/label）・発行/期限・端末識別のみ。SID・コード・tokenをログへ出さない。
 * - 現在端末のログアウト（revoke）とPRESIDENTによる全端末失効（revokeAll）を提供する。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Principal } from '../domain/types.js';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 3600_000;

interface PairingCode {
  codeHash: string;
  principal: Principal;
  expiresAt: number;
  attempts: number;
  used: boolean;
}

interface DeviceSession {
  sidHash: string;
  principal: Principal;
  createdAt: string;
  expiresAt: number;
  deviceInfo: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** プライベートIP（LAN）か。LAN外からのペアリング要求は拒否する */
export function isPrivateAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace('::ffff:', '');
  if (a === '::1' || a === '127.0.0.1' || a.startsWith('127.')) return true;
  if (a.startsWith('10.') || a.startsWith('192.168.')) return true;
  const m = a.match(/^172\.(\d+)\./);
  if (m) { const o = Number(m[1]); return o >= 16 && o <= 31; }
  if (a.startsWith('fe80:') || a.startsWith('fd')) return true;
  return false;
}

export type ClaimResult =
  | { ok: true; sid: string }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'LOCKED' | 'NOT_LAN' };

export class DevicePairingService {
  private codes: PairingCode[] = [];
  private sessions: DeviceSession[] = [];

  constructor(private readonly file = join('.', 'secure', 'device-sessions.json'), private readonly now: () => number = Date.now) {
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Array<DeviceSession & { boundToken?: string }>;
        // 旧形式（boundToken平文）は移行せず破棄する＝該当端末は再ペアリングが必要（手順はREADME/受入資料に明記）
        this.sessions = raw.filter((s) => s.principal && !s.boundToken && s.expiresAt > this.now());
      } catch { this.sessions = []; }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.sessions, null, 2), 'utf8');
    renameSync(tmp, this.file);
    // 所有者のみ読書き（POSIXは0600。Windowsはicaclsで現ユーザーのみへ制限）
    try {
      if (process.platform === 'win32') {
        execSync(`icacls "${this.file}" /inheritance:r /grant:r "%USERNAME%:(F)"`, { stdio: 'ignore' });
      } else {
        chmodSync(this.file, 0o600);
      }
    } catch { /* 権限設定失敗でも機能は継続（ファイルにtoken平文は無い） */ }
  }

  /** PC側（認証済みprincipal）から発行。既存の未使用コードは無効化（常に最新1つ） */
  startPairing(principal: Principal): { code: string; expiresInSec: number } {
    this.codes = this.codes.filter((c) => !c.used && c.expiresAt > this.now() && c.principal.label !== principal.label);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.push({ codeHash: sha256(code), principal, expiresAt: this.now() + CODE_TTL_MS, attempts: 0, used: false });
    return { code, expiresInSec: CODE_TTL_MS / 1000 };
  }

  claim(code: string, remoteAddr: string | undefined, deviceInfo = ''): ClaimResult {
    if (!isPrivateAddress(remoteAddr)) return { ok: false, reason: 'NOT_LAN' };
    const hash = sha256((code || '').trim());
    const candidate = this.codes.find((c) => !c.used && c.codeHash === hash);
    if (!candidate) {
      for (const c of this.codes) c.attempts += 1;
      const locked = this.codes.some((c) => c.attempts >= MAX_ATTEMPTS && !c.used);
      if (locked) this.codes = this.codes.filter((c) => c.attempts < MAX_ATTEMPTS);
      return { ok: false, reason: locked ? 'LOCKED' : 'INVALID' };
    }
    if (candidate.expiresAt <= this.now()) {
      this.codes = this.codes.filter((c) => c !== candidate);
      return { ok: false, reason: 'EXPIRED' };
    }
    candidate.used = true;
    const sid = randomBytes(24).toString('base64url');
    this.sessions.push({
      sidHash: sha256(sid),
      principal: candidate.principal,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: this.now() + SESSION_TTL_MS,
      deviceInfo: deviceInfo.slice(0, 120)
    });
    this.persist();
    return { ok: true, sid };
  }

  /** 認証済みPrincipalへ直接セッションを発行（PC側の?token=→cookie交換用。コード不要） */
  issueSession(principal: Principal, deviceInfo = ''): string {
    const sid = randomBytes(24).toString('base64url');
    this.sessions.push({
      sidHash: sha256(sid), principal,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: this.now() + SESSION_TTL_MS,
      deviceInfo: deviceInfo.slice(0, 120)
    });
    this.persist();
    return sid;
  }

  /** cookieのSIDをPrincipalへ解決（期限切れはnull。tokenは保存していない） */
  resolveSession(sid: string | undefined): Principal | null {
    if (!sid) return null;
    const hash = sha256(sid);
    const hit = this.sessions.find((s) => s.sidHash === hash && s.expiresAt > this.now());
    return hit ? hit.principal : null;
  }

  /** 現在端末のログアウト */
  revoke(sid: string | undefined): boolean {
    if (!sid) return false;
    const hash = sha256(sid);
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.sidHash !== hash);
    if (this.sessions.length !== before) { this.persist(); return true; }
    return false;
  }

  /** 全端末失効（PRESIDENTのみ・routes側でRBAC強制） */
  revokeAll(): number {
    const n = this.sessions.length;
    this.sessions = [];
    this.persist();
    return n;
  }

  sessionCount(): number { return this.sessions.filter((s) => s.expiresAt > this.now()).length; }
}
