/**
 * 端末ペアリング（iPhone接続）: 6桁コード→HttpOnlyセッション発行。
 *
 * - 通常導線からURLの?token=手入力を廃止するための仕組み（既存token認証は互換維持）。
 * - コードは5分有効・1回限り・試行5回まで・LAN(プライベートIP)からのみ受理。
 * - セッションIDはSHA-256ハッシュのみ保存（secure/配下・Git外）。コード・SID・tokenをログへ出さない。
 * - 認証を弱めない: セッションは発行元Bearer tokenと同じprincipalに解決される。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 3600_000;

interface PairingCode {
  codeHash: string;
  boundToken: string;
  expiresAt: number;
  attempts: number;
  used: boolean;
}

interface DeviceSession {
  sidHash: string;
  boundToken: string;
  createdAt: string;
  expiresAt: number;
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
        this.sessions = (JSON.parse(readFileSync(this.file, 'utf8')) as DeviceSession[]).filter((s) => s.expiresAt > this.now());
      } catch { this.sessions = []; }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.sessions, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }

  /** PC側（認証済みprincipalのtoken）から発行。既存の未使用コードは無効化（常に最新1つ） */
  startPairing(boundToken: string): { code: string; expiresInSec: number } {
    this.codes = this.codes.filter((c) => !c.used && c.expiresAt > this.now() && c.boundToken !== boundToken);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.push({ codeHash: sha256(code), boundToken, expiresAt: this.now() + CODE_TTL_MS, attempts: 0, used: false });
    return { code, expiresInSec: CODE_TTL_MS / 1000 };
  }

  claim(code: string, remoteAddr: string | undefined): ClaimResult {
    if (!isPrivateAddress(remoteAddr)) return { ok: false, reason: 'NOT_LAN' };
    const hash = sha256((code || '').trim());
    const candidate = this.codes.find((c) => !c.used && c.codeHash === hash);
    if (!candidate) {
      // 一致しない入力も全体の試行として数える（総当たり対策）
      for (const c of this.codes) c.attempts += 1;
      const locked = this.codes.some((c) => c.attempts >= MAX_ATTEMPTS && !c.used);
      if (locked) this.codes = this.codes.filter((c) => c.attempts < MAX_ATTEMPTS);
      return { ok: false, reason: locked ? 'LOCKED' : 'INVALID' };
    }
    if (candidate.expiresAt <= this.now()) {
      this.codes = this.codes.filter((c) => c !== candidate);
      return { ok: false, reason: 'EXPIRED' };
    }
    candidate.used = true; // 使い捨て
    const sid = randomBytes(24).toString('base64url');
    this.sessions.push({ sidHash: sha256(sid), boundToken: candidate.boundToken, createdAt: new Date(this.now()).toISOString(), expiresAt: this.now() + SESSION_TTL_MS });
    this.persist();
    return { ok: true, sid };
  }

  /** cookieのSIDをtokenへ解決（期限切れはnull） */
  resolveSession(sid: string | undefined): string | null {
    if (!sid) return null;
    const hash = sha256(sid);
    const hit = this.sessions.find((s) => s.sidHash === hash && s.expiresAt > this.now());
    return hit ? hit.boundToken : null;
  }
}
