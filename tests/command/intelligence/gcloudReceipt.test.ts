import { describe, expect, it } from 'vitest';
import {
  buildReceipt,
  desiredResources,
  planSetup,
  planTeardown,
  resourceKey
} from '../../../src/command/integrations/gcloud/receipt.js';

const P = 'lcc-command';

describe('GCloud setup/teardown計画（receipt方式・ps1と同一規則のmock E2E）', () => {
  it('E2E: setup→teardown→再setupのサイクル（冪等・共有リソース保護）', () => {
    const desired = desiredResources(P);
    // --- 初回setup: 空環境 → 全リソース作成 ---
    const existing = new Set<string>();
    const plan1 = planSetup(desired, existing);
    expect(plan1.skip).toHaveLength(0);
    expect(plan1.create.length).toBe(desired.length);
    for (const r of plan1.create) existing.add(resourceKey(r));
    // deploy時に共有リソースも自動作成される（receiptへは載せない=shared）
    existing.add('bucket:lcc-command_cloudbuild');
    const receipt = buildReceipt(P, 'asia-northeast1', plan1.create, '2026-08-15T00:00:00Z');
    expect(receipt.created.every((r) => !r.shared)).toBe(true); // API有効化等の共有はreceiptに含めない
    expect(receipt.created.some((r) => r.kind === 'service-account' && r.id.startsWith('lcc-build@'))).toBe(true); // 専用build SA

    // --- teardown: receipt記載の自作リソースのみ削除・共有は保護 ---
    const td = planTeardown(receipt, existing);
    expect(td.delete.length).toBeGreaterThan(0);
    // 共有Artifact Registry repo・Cloud Buildバケットは削除対象に含まれない
    expect(td.delete.some((r) => r.id === 'cloud-run-source-deploy')).toBe(false);
    expect(td.delete.some((r) => /cloudbuild/i.test(r.id) && r.kind === 'bucket')).toBe(false);
    // relayイメージ（共有repo内の自作分）は削除対象に含まれる
    expect(td.delete.some((r) => r.kind === 'artifact-image')).toBe(true);
    for (const r of td.delete) existing.delete(resourceKey(r));
    expect(existing.has('bucket:lcc-command_cloudbuild')).toBe(true); // 共有bucketは残る

    // --- teardown再実行: 既に消えている分はalreadyGone（エラーにしない=冪等） ---
    const td2 = planTeardown(receipt, existing);
    expect(td2.delete).toHaveLength(0);
    expect(td2.alreadyGone.length).toBe(td.delete.length);

    // --- 再setup: API等の共有はskip・自作分のみ再作成（途中失敗からの再実行と同型） ---
    const plan2 = planSetup(desired, existing);
    expect(plan2.skip.some((r) => r.kind === 'api')).toBe(true); // API有効化は残っている→skip
    expect(plan2.create.some((r) => r.kind === 'topic')).toBe(true); // 削除済みの自作分は再作成
  });

  it('途中失敗からの再実行: 半分だけ作成済みの状態では残りだけをcreateする（冪等）', () => {
    const desired = desiredResources(P);
    const half = new Set(desired.slice(0, Math.floor(desired.length / 2)).map(resourceKey));
    const plan = planSetup(desired, half);
    expect(plan.skip.length + plan.create.length).toBe(desired.length);
    expect(plan.skip.length).toBe(half.size);
    // skipとcreateに重複がない
    const overlap = plan.create.filter((c) => half.has(resourceKey(c)));
    expect(overlap).toHaveLength(0);
  });

  it('正準リスト: outbox bucket・build SA・runtime SAが分離定義されている', () => {
    const desired = desiredResources(P);
    expect(desired.some((r) => r.kind === 'bucket' && r.id === 'lcc-command-lineworks-outbox')).toBe(true);
    expect(desired.some((r) => r.id.startsWith('lcc-build@'))).toBe(true);
    expect(desired.some((r) => r.id.startsWith('lcc-lineworks-relay@'))).toBe(true);
  });
});
