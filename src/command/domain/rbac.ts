/**
 * RBAC（役割ベースアクセス制御）。
 *
 * 原則:
 * - グループ全体資金・法人横断情報・高機密情報へアクセスできるのは PRESIDENT / SYSTEM のみ。
 * - EXECUTIVE / MANAGER / STAFF は許可された法人のデータのみ。
 * - UIで隠すだけの制御は禁止。APIルートとTool実行の両方でScopeを強制する。
 *
 * Phase Aの認証は設定由来（LCC_COMMAND_API_TOKENS）で、Phase Bで
 * Google Workspace認証（Google Identity）へ置き換える。認可判定はこのモジュールに残る。
 */
import type { CompanyScope, Principal, Role } from './types.js';

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

const CROSS_COMPANY_ROLES: Role[] = ['PRESIDENT', 'SYSTEM'];

export function canAccessScope(principal: Principal, scope: CompanyScope): boolean {
  if (CROSS_COMPANY_ROLES.includes(principal.role)) return true;
  if (scope === 'group') return false; // グループ横断は経営者のみ
  return principal.companyIds.includes(scope);
}

export function assertScopeAllowed(principal: Principal, scope: CompanyScope): void {
  if (!canAccessScope(principal, scope)) {
    throw new AccessDeniedError(
      `ロール${principal.role}（${principal.label}）にはスコープ「${scope}」へのアクセス権がありません`
    );
  }
}

/** Write系Tool（承認リクエスト作成等）を起こせるロール */
export function canRequestWrite(principal: Principal): boolean {
  return principal.role !== 'STAFF';
}

/** 承認の実行（approve/reject）ができるロール */
export function canDecideApproval(principal: Principal): boolean {
  return principal.role === 'PRESIDENT' || principal.role === 'EXECUTIVE';
}

/** 経営判断Memory（Decision）を登録できるロール。AI/SYSTEMには許可しない。 */
export function canRecordDecision(principal: Principal): boolean {
  return principal.role === 'PRESIDENT' || principal.role === 'EXECUTIVE';
}

export interface TokenConfigEntry {
  role: Role;
  companyIds: string[];
  label?: string;
}

/**
 * Authorizationヘッダから主体を解決する。
 * - LCC_COMMAND_API_TOKENS='{"<token>":{"role":"PRESIDENT","companyIds":["*"]}}' 形式。
 * - demoモードのみ、トークン未設定時に PRESIDENT を既定とする（本番では必ず401）。
 */
export function resolvePrincipal(
  authorizationHeader: string | undefined,
  mode: 'demo' | 'production',
  tokensJson: string | undefined
): Principal | null {
  const tokens = parseTokens(tokensJson);
  if (tokens) {
    const token = (authorizationHeader ?? '').replace(/^Bearer\s+/i, '').trim();
    const entry = token ? tokens[token] : undefined;
    if (!entry) return null;
    return {
      role: entry.role,
      companyIds: entry.companyIds.includes('*') ? [] : entry.companyIds,
      label: entry.label ?? entry.role
    };
  }
  if (mode === 'demo') {
    // デモモード限定の既定主体。実データ接続時は必ずトークン設定が必要。
    return { role: 'PRESIDENT', companyIds: [], label: 'demo-president' };
  }
  return null;
}

function parseTokens(tokensJson: string | undefined): Record<string, TokenConfigEntry> | null {
  if (!tokensJson || tokensJson.trim().length === 0) return null;
  try {
    return JSON.parse(tokensJson) as Record<string, TokenConfigEntry>;
  } catch {
    // 設定破損時はフェイルクローズ（誰も認証されない）
    return {};
  }
}
