import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevicePairingService, isPrivateAddress } from '../../../src/command/server/devicePairing.js';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'lcc-pair-')), 'sessions.json');

describe('端末ペアリング（6桁コード→HttpOnlyセッション）', () => {
  it('正しいコードでセッション発行、同コードは使い捨て', () => {
    const svc = new DevicePairingService(tmpFile());
    const { code, expiresInSec } = svc.startPairing('token-a');
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresInSec).toBe(300);
    const r1 = svc.claim(code, '192.168.128.10');
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(svc.resolveSession(r1.sid)).toBe('token-a');
    const r2 = svc.claim(code, '192.168.128.10');
    expect(r2.ok).toBe(false); // 1回限り
  });

  it('期限切れはEXPIRED、誤コード連続でLOCKED', () => {
    let t = 1_000_000;
    const svc = new DevicePairingService(tmpFile(), () => t);
    const { code } = svc.startPairing('token-a');
    t += 5 * 60_000 + 1;
    expect(svc.claim(code, '10.0.0.5')).toEqual({ ok: false, reason: 'EXPIRED' });
    svc.startPairing('token-b');
    for (let i = 0; i < 4; i++) expect(svc.claim('000001', '10.0.0.5').ok).toBe(false);
    const locked = svc.claim('000001', '10.0.0.5');
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe('LOCKED');
  });

  it('LAN外アドレスからのclaimは拒否（NOT_LAN）', () => {
    const svc = new DevicePairingService(tmpFile());
    const { code } = svc.startPairing('token-a');
    expect(svc.claim(code, '203.0.113.7')).toEqual({ ok: false, reason: 'NOT_LAN' });
    expect(isPrivateAddress('::ffff:192.168.1.2')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('セッションは永続化され再起動後も解決できる（SIDはハッシュ保存）', () => {
    const file = tmpFile();
    const svc = new DevicePairingService(file);
    const { code } = svc.startPairing('token-a');
    const r = svc.claim(code, '127.0.0.1');
    expect(r.ok).toBe(true);
    const sid = r.ok ? r.sid : '';
    const svc2 = new DevicePairingService(file);
    expect(svc2.resolveSession(sid)).toBe('token-a');
    expect(svc2.resolveSession('wrong-sid')).toBeNull();
    // ファイルへSID平文が保存されていないこと
    const raw = readFileSync(file, 'utf8');
    expect(raw.includes(sid)).toBe(false);
  });
});
