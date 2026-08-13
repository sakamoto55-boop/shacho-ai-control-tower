import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CORE_CLUSTER } from '../../../src/command/vui/visualSpec.js';

const UI_HTML = readFileSync('docs/lcc-command-vui.html', 'utf8');

describe('EXECUTIVE COMMAND CENTER UI（UI REBUILD検収）', () => {
  it('AI CORE集合体仕様がUIとvisualSpecで同期している（CORE_CLUSTER）', () => {
    const m = UI_HTML.match(/const CORE_CLUSTER = \{([^}]+)\}/);
    expect(m, 'UI側CORE_CLUSTER定義').toBeTruthy();
    const body = m![1];
    expect(body).toContain(`nuclei: ${CORE_CLUSTER.nuclei}`);
    expect(body).toContain(`nucleusSpread: ${CORE_CLUSTER.nucleusSpread}`);
    expect(body).toContain(`linkCount: ${CORE_CLUSTER.linkCount}`);
    expect(body).toContain(`linkMaxDist: ${CORE_CLUSTER.linkMaxDist}`);
    expect(body).toContain(`depthLayers: ${CORE_CLUSTER.depthLayers}`);
  });

  it('日本語IME変換中の誤送信防止（composition + keyCode 229）が実装されている', () => {
    expect(UI_HTML).toContain('compositionstart');
    expect(UI_HTML).toContain('compositionend');
    expect(UI_HTML).toContain('keyCode === 229');
  });

  it('モバイル用の下部ナビが存在し、絵文字アイコンを使っていない', () => {
    expect(UI_HTML).toContain('bottom-nav');
    expect(UI_HTML).toContain('モバイルナビゲーション');
    // ナビ項目はSVGアイコン+日本語名称
    expect(UI_HTML).toContain('朝の管制');
    expect(UI_HTML).toContain('データ接続');
    const nav = UI_HTML.match(/<nav[^>]*メインナビゲーション[\s\S]*?<\/nav>/);
    expect(nav).toBeTruthy();
    for (const emoji of ['💬', '☀️', '🧠', '⚙️']) expect(nav![0].includes(emoji)).toBe(false);
  });

  it('KPI未取得時は—+理由+接続状態導線を表示する（架空数値なし）', () => {
    expect(UI_HTML).toContain('銀行未接続');
    expect(UI_HTML).toContain('接続状態を見る');
  });

  it('ホームは実データの件数のみ表示し、取得不能は—と理由を出す', () => {
    expect(UI_HTML).toContain('MORNING COMMAND BRIEF');
    expect(UI_HTML).toContain('将軍の判断が必要なのは');
    expect(UI_HTML).toContain('取得不能');
  });

  it('技術用語（VERY_STALE等）を通常画面から除去し、接続画面の語彙として保持する', () => {
    expect(UI_HTML).toContain('データが古い可能性'); // KPI表示での置換
    expect(UI_HTML).toContain('SHEET_INGESTED'); // データ接続画面の正直語彙としては保持
    expect(UI_HTML).toContain('本体API接続と表現しません');
  });

  it('「重要Alert」は「重要事項」へ統一され、未検証の学習機能表示がない', () => {
    expect(UI_HTML).not.toContain('重要Alert');
    expect(UI_HTML).toContain('重要事項');
    expect(UI_HTML).not.toContain('会話から学習した内容が表示されます');
  });

  it('認証エラー(401)を接続エラーと区別して表示する（MOBILE VISUAL CORRECTION）', () => {
    expect(UI_HTML).toContain('authRequired');
    expect(UI_HTML).toContain('認証が必要です');
    expect(UI_HTML).toContain('接続は正常');
    expect(UI_HTML).toContain("markAuth(res.status)");
  });

  it('モバイルは縦書き禁止・単一ステータスバー・AI CORE重複なし・ホームで入力バー非表示', () => {
    expect(UI_HTML).not.toContain('writing-mode');
    expect(UI_HTML).toContain('whitespace-nowrap'); // ヘッダーボタンの1文字折返し防止
    expect(UI_HTML).toContain('単一ステータスバー');
    expect(UI_HTML).toContain('hidden lg:block'); // AI CORE詳細カードはPCのみ
    expect(UI_HTML).toContain("view === 'chat' || (view === 'home' && isDesktop)"); // モバイルホームは入力バー非表示
    expect(UI_HTML).toContain('AIに聞く（質問・音声入力はこちら）');
    expect(UI_HTML).toMatch(/max-width:1023px[\s\S]*?\.role-chip\{display:none\}/); // モバイルはRole Ring非表示
  });

  it('接続エラー時に入力内容を保持する', () => {
    expect(UI_HTML).toContain('エラー時も入力内容を保持');
    expect(UI_HTML).toContain('入力内容は残してあります');
  });

  it('EXECUTIVE INTELLIGENCE OSブランド表記と利用者表示がある', () => {
    expect(UI_HTML).toContain('EXECUTIVE INTELLIGENCE OS');
    expect(UI_HTML).toContain('利用者: 将軍');
  });

  it('reduced-motionでは静的表示（既存保証の回帰確認）', () => {
    expect(UI_HTML).toContain('prefers-reduced-motion');
    expect(UI_HTML).toContain('core-static');
  });
});
