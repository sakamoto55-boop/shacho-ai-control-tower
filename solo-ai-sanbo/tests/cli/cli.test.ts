import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { Store } from '../../src/repositories/Store.js';

describe('CLI', () => {
  let dir: string;
  let store: Store;
  const run = (line: string) => runCli(line.split(' ').filter(Boolean), store);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanbo-'));
    store = new Store(join(dir, 'sanbo.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('引数なしでヘルプを返す', async () => {
    expect(await runCli([], store)).toContain('AI参謀');
  });

  it('柱を足して一覧に出す', async () => {
    await run('pillar add 解体の個人受注 --kind service --review 30日後 --target 30万');
    const list = await run('pillar list');

    expect(list).toContain('解体の個人受注');
    expect(list).toContain('基準30万円');
  });

  it('見直し日と撤退基準がない柱には、その場で促す', async () => {
    const output = await run('pillar add 発信 --kind content');

    expect(output).toContain('見直し日が未設定');
    expect(output).toContain('撤退基準');
  });

  it('柱と案件を名前の一部で指せる', async () => {
    await run('pillar add 解体の個人受注 --kind service');
    await run('deal add 空き家解体 --pillar 解体 --client 田中様 --amount 150万');
    const list = await run('deal list');

    expect(list).toContain('空き家解体');
    expect(list).toContain('150万円');
  });

  it('案件を指定すれば柱は指定しなくてよい', async () => {
    await run('pillar add 解体の個人受注 --kind service');
    await run('deal add 空き家解体 --pillar 解体');
    await run('time 120 --deal 空き家 --cat delivery');

    const entries = await store.listTimeEntries();
    const pillars = await store.listPillars();
    expect(entries).toHaveLength(1);
    expect(entries[0].pillarId).toBe(pillars[0].id);
    expect(entries[0].dealId).not.toBeNull();
  });

  it('入金済みへ進めたとき、金額の記録がまだなら促す', async () => {
    await run('pillar add 解体の個人受注 --kind service');
    await run('deal add 空き家解体 --pillar 解体 --amount 150万');
    const output = await run('deal move 空き家 paid');

    expect(output).toContain('入金の記録はまだです');
  });

  it('時間とお金を記録して週の数字に反映する', async () => {
    await run('pillar add 解体の個人受注 --kind service');
    await run('time 120 --pillar 解体 --cat delivery');
    await run('money in 30万 --pillar 解体 --label 解体一式');
    await run('money out 10万 --pillar 解体 --label 処分費');

    const review = await run('review');
    expect(review).toContain('粗利 20万円');
    expect(review).toContain('100,000円/時');
  });

  it('存在しない柱を指したら、確認方法まで伝える', async () => {
    await expect(run('deal add テスト --pillar ないやつ')).rejects.toThrow('pillar list');
  });

  it('指定があいまいなら候補を返す', async () => {
    await run('pillar add 解体A --kind service');
    await run('pillar add 解体B --kind service');

    await expect(run('deal add テスト --pillar 解体')).rejects.toThrow('あいまい');
  });

  it('知らないコマンドはヘルプごと返す', async () => {
    await expect(run('foo bar')).rejects.toThrow('知らないコマンド');
  });

  it('下書きを作るが、送信はしないと明示する', async () => {
    const output = await runCli(['draft', 'reply', '見積をお願いします'], store);

    expect(output).toContain('下書き（ここから）');
    expect(output).toContain('送信も投稿もしていません');
    expect(output).toContain('AIが決めなかったところ');
  });
});
