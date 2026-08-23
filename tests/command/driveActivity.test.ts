import { describe, expect, it, vi } from 'vitest';
import { classifyActivity, loadCompanyActivity } from '../../src/command/sources/driveActivity.js';

describe('会社の動き（Driveアクティビティ分類）', () => {
  it('ファイル名から業務シグナルと人数を推定する', () => {
    // 名前に手掛かりが無い汎用名は「その他」（勝手に決めつけない）
    expect(classifyActivity('★R8年度(3月～).xlsx', 'application/vnd.ms-excel').signal).toBe('その他');
    expect(classifyActivity('月末支払 一覧表.xlsx', 'application/vnd.ms-excel').signal).toBe('資金');
    expect(classifyActivity('(有)ニシコオリ 見積.pdf', 'application/pdf').signal).toBe('見積');
    expect(classifyActivity('02_建設工事請負契約書（JV用）_v3.docx', 'x').signal).toBe('契約');
    const nippou = classifyActivity('8月20日「木曜日」作業日報23名 請負15名 常用8名.HEIC', 'image/heif');
    expect(nippou.signal).toBe('現場日報');
    expect(nippou.headcount).toBe(23);
  });

  it('SA未設定なら available:false（例外にしない）', async () => {
    const r = await loadCompanyActivity('2026-08-13T00:00:00Z', {} as NodeJS.ProcessEnv);
    expect(r.available).toBe(false);
  });

  it('取得成功時はフォルダを除外して分類済みitemsを返す', async () => {
    const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x' }) } as unknown as NodeJS.ProcessEnv;
    // getTokenを差し替え（buildAssertionの実鍵署名を回避）してfetchをmock
    const gs = await import('../../src/command/sources/googleSheets.js');
    vi.spyOn(gs.ServiceAccountTokenProvider.prototype, 'getToken').mockResolvedValue('TOK');
    const files = [
      // 既知の資金繰表ファイルID → 名前に手掛かりが無くても「資金」に確定
      { id: '1Q7WS1lpbYwXXNxTPJJjd1IkPyqK17ui2', name: '★R8年度(3月～).xlsx', mimeType: 'application/vnd.ms-excel', modifiedTime: '2026-08-20T00:00:00Z' },
      { id: '2', name: '経理（資金繰表）', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-08-19T00:00:00Z' }
    ];
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ files }) }) as unknown as Response);
    const r = await loadCompanyActivity('2026-08-13T00:00:00Z', env, fetchImpl as unknown as typeof fetch);
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.items.every((it) => it.signal !== 'フォルダ')).toBe(true);
      expect(r.items).toHaveLength(1);
      expect(r.items[0].signal).toBe('資金');
    }
    vi.restoreAllMocks();
  });
});
