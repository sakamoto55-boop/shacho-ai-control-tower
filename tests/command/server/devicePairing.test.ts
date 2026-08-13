import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevicePairingService, isPrivateAddress } from '../../../src/command/server/devicePairing.js';
import type { Principal } from '../../../src/command/domain/types.js';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'lcc-pair-')), 'sessions.json');
const PRES: Principal = { role: 'PRESIDENT', companyIds: ['*'], label: '社長' };

describe('端末ペアリング（6桁コード→HttpOnlyセッション・CODEX是正3）', () => {
  it('正しいコードでセッション発行、同コードは使い捨て。解決はPrincipal（token非保存）', () => {
    const svc = new DevicePairingService(tmpFile());
    const { code, expiresInSec } = svc.startPairing(PRES);
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresInSec).toBe(300);
    const r1 = svc.claim(code, '192.168.128.10', 'iPhone Safari');
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(svc.resolveSession(r1.sid)).toEqual(PRES);
    expect(svc.claim(code, '192.168.128.10').ok).toBe(false); // 1回限り
  });

  it('期限切れはEXPIRED、誤コード連続でLOCKED', () => {
    let t = 1_000_000;
    const svc = new DevicePairingService(tmpFile(), () => t);
    const { code } = svc.startPairing(PRES);
    t += 5 * 60_000 + 1;
    expect(svc.claim(code, '10.0.0.5')).toEqual({ ok: false, reason: 'EXPIRED' });
    svc.startPairing({ ...PRES, label: '別発行' });
    for (let i = 0; i < 4; i++) expect(svc.claim('000001', '10.0.0.5').ok).toBe(false);
    const locked = svc.claim('000001', '10.0.0.5');
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe('LOCKED');
  });

  it('LAN外アドレスからのclaimは拒否（NOT_LAN）', () => {
    const svc = new DevicePairingService(tmpFile());
    const { code } = svc.startPairing(PRES);
    expect(svc.claim(code, '203.0.113.7')).toEqual({ ok: false, reason: 'NOT_LAN' });
    expect(isPrivateAddress('::ffff:192.168.1.2')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('永続化ファイルにSID平文・Bearer tokenが存在せず、再起動後も解決・失効できる', () => {
    const file = tmpFile();
    const svc = new DevicePairingService(file);
    const { code } = svc.startPairing(PRES);
    const r = svc.claim(code, '127.0.0.1', 'test-device');
    expect(r.ok).toBe(true);
    const sid = r.ok ? r.sid : '';
    const raw = readFileSync(file, 'utf8');
    expect(raw.includes(sid)).toBe(false); // SIDはハッシュのみ
    expect(raw).not.toContain('boundToken'); // token平文フィールドなし
    expect(raw).toContain('sidHash');
    expect(raw).toContain('deviceInfo');
    const svc2 = new DevicePairingService(file);
    expect(svc2.resolveSession(sid)).toEqual(PRES);
    expect(svc2.revoke(sid)).toBe(true); // ログアウト
    expect(svc2.resolveSession(sid)).toBeNull();
  });

  it('exchange発行と全端末失効（revokeAll）', () => {
    const svc = new DevicePairingService(tmpFile());
    const s1 = svc.issueSession(PRES, 'PC Chrome');
    svc.issueSession({ role: 'STAFF', companyIds: ['lcc'], label: '担当' }, 'iPhone');
    expect(svc.sessionCount()).toBe(2);
    expect(svc.resolveSession(s1)?.role).toBe('PRESIDENT');
    expect(svc.revokeAll()).toBe(2);
    expect(svc.resolveSession(s1)).toBeNull();
    expect(svc.sessionCount()).toBe(0);
  });

  it('旧形式（boundToken平文）のセッションは読み込まず破棄する（再ペアリング要）', () => {
    const file = tmpFile();
    const legacy = [{ sidHash: 'x', boundToken: 'secret-token', createdAt: '2026-08-13', expiresAt: Date.now() + 10_000_000 }];
    writeFileSync(file, JSON.stringify(legacy));
    const svc = new DevicePairingService(file);
    expect(svc.sessionCount()).toBe(0);
  });
});
