/**
 * GCloud setup/teardownの計画・receipt（純関数）。
 *
 * gcloud-setup-realtime.ps1 / gcloud-teardown-realtime.ps1 はこのモジュールと同じ規則で動く:
 * - setupは冪等: 既存リソースはskipし、作成した分だけをreceiptへ記録する（途中失敗から再実行可能）
 * - teardownはreceiptに記録された自作リソースのみ削除する
 * - 共有リソース（cloud-run-source-deploy repository・Cloud Build bucket）は丸ごと削除しない
 *   （relayイメージ等の「中身のうち自作分」の削除のみ許可）
 */

export type ResourceKind =
  | 'api' | 'topic' | 'subscription' | 'service-account' | 'secret'
  | 'run-service' | 'bucket' | 'iam-binding' | 'artifact-image';

export interface GcloudResource {
  kind: ResourceKind;
  id: string;
  /** 共有リソース（丸ごと削除禁止）。API有効化も他用途と共有のため削除対象にしない */
  shared?: boolean;
}

/** 本設定が必要とするリソースの正準リスト（これ以外は作らない） */
export function desiredResources(projectId: string, region = 'asia-northeast1'): GcloudResource[] {
  const relaySa = `lcc-lineworks-relay@${projectId}.iam.gserviceaccount.com`;
  const buildSa = `lcc-build@${projectId}.iam.gserviceaccount.com`;
  return [
    { kind: 'api', id: 'gmail.googleapis.com', shared: true },
    { kind: 'api', id: 'pubsub.googleapis.com', shared: true },
    { kind: 'api', id: 'run.googleapis.com', shared: true },
    { kind: 'api', id: 'secretmanager.googleapis.com', shared: true },
    { kind: 'api', id: 'cloudbuild.googleapis.com', shared: true },
    { kind: 'api', id: 'artifactregistry.googleapis.com', shared: true },
    { kind: 'topic', id: 'lcc-gmail-events' },
    { kind: 'topic', id: 'lcc-lineworks-events' },
    { kind: 'subscription', id: 'lcc-gmail-events-pull' },
    { kind: 'subscription', id: 'lcc-lineworks-events-pull' },
    { kind: 'service-account', id: relaySa },
    { kind: 'service-account', id: buildSa },
    { kind: 'secret', id: 'lineworks-bot-secret' },
    { kind: 'bucket', id: `${projectId}-lineworks-outbox` },
    { kind: 'run-service', id: `lcc-lineworks-relay@${region}` },
    // deployが共有repoへ作るrelayイメージ（repo自体はsharedのため削除対象外・イメージのみ削除可）
    { kind: 'artifact-image', id: `${region}-docker.pkg.dev/${projectId}/cloud-run-source-deploy/lcc-lineworks-relay` }
  ];
}

/** teardownで絶対に削除してはいけない共有リソース */
export const PROTECTED_SHARED_IDS = ['cloud-run-source-deploy'];
export const PROTECTED_SHARED_PATTERNS = [/cloudbuild/i];

export interface SetupPlan {
  create: GcloudResource[];
  skip: GcloudResource[];
}

const key = (r: GcloudResource): string => `${r.kind}:${r.id}`;

/** 冪等setup計画: 既存はskip（途中失敗からの再実行で二重作成しない） */
export function planSetup(desired: GcloudResource[], existingKeys: Set<string>): SetupPlan {
  const create: GcloudResource[] = [];
  const skip: GcloudResource[] = [];
  for (const r of desired) (existingKeys.has(key(r)) ? skip : create).push(r);
  return { create, skip };
}

export interface SetupReceipt {
  projectId: string;
  region: string;
  createdAt: string;
  /** このsetup実行で実際に作成したリソースのみ（skip分は含めない） */
  created: GcloudResource[];
}

export function buildReceipt(projectId: string, region: string, created: GcloudResource[], createdAt: string): SetupReceipt {
  return { projectId, region, createdAt, created: created.filter((r) => !r.shared) };
}

export interface TeardownPlan {
  delete: GcloudResource[];
  /** 共有のため削除しない（保護） */
  protected: GcloudResource[];
  /** receiptにあるが既に存在しない（冪等: エラーにしない） */
  alreadyGone: GcloudResource[];
}

/** teardown計画: receiptの自作リソースのみ削除。共有repo/bucketは保護 */
export function planTeardown(receipt: SetupReceipt, existingKeys: Set<string>): TeardownPlan {
  const del: GcloudResource[] = [];
  const prot: GcloudResource[] = [];
  const gone: GcloudResource[] = [];
  for (const r of receipt.created) {
    const isProtected = r.shared
      || PROTECTED_SHARED_IDS.some((p) => r.id === p)
      || (r.kind === 'bucket' && PROTECTED_SHARED_PATTERNS.some((re) => re.test(r.id)));
    if (isProtected) { prot.push(r); continue; }
    if (!existingKeys.has(key(r))) { gone.push(r); continue; }
    del.push(r);
  }
  return { delete: del, protected: prot, alreadyGone: gone };
}

export const resourceKey = key;
