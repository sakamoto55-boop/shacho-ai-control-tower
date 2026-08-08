/**
 * Google Identity 認証。
 *
 * Authentication（本人確認）とAuthorization（権限判定）を分離する:
 *   ユーザーのGoogleアカウント → Identity（IDトークン検証）
 *   → LCC COMMAND User（ディレクトリでemail→ユーザー解決）
 *   → Role / Company Scope（既存RBAC。rbac.tsは変更しない）
 *
 * Phase B0では検証器をAdapter化し、本番はGoogleのtokeninfoエンドポイント
 * （公開APIでのIDトークン検証）を使う。認可ロジックはrbac.tsのまま。
 */
import type { Principal, Role } from '../domain/types.js';

export interface VerifiedIdentity {
  email: string;
  audience: string;
  /** epoch秒 */
  expiresAt: number;
  emailVerified: boolean;
}

export interface IdTokenVerifier {
  /** 検証失敗はnull（理由はログのみ。呼び出し元は401にする） */
  verify(idToken: string): Promise<VerifiedIdentity | null>;
}

/** GoogleのIDトークンをtokeninfoエンドポイントで検証する実装 */
export class GoogleTokenInfoVerifier implements IdTokenVerifier {
  constructor(
    private readonly expectedAudience: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async verify(idToken: string): Promise<VerifiedIdentity | null> {
    try {
      const res = await this.fetchImpl(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, string>;
      const identity: VerifiedIdentity = {
        email: body.email ?? '',
        audience: body.aud ?? '',
        expiresAt: Number(body.exp ?? 0),
        emailVerified: body.email_verified === 'true'
      };
      return validateIdentity(identity, this.expectedAudience) ? identity : null;
    } catch {
      return null;
    }
  }
}

export function validateIdentity(identity: VerifiedIdentity, expectedAudience: string): boolean {
  if (!identity.email || !identity.emailVerified) return false;
  if (identity.audience !== expectedAudience) return false; // audience不一致 = 他アプリのトークン
  if (identity.expiresAt * 1000 < Date.now()) return false;
  return true;
}

export interface UserDirectoryEntry {
  role: Role;
  /** '*' で全法人（PRESIDENT/SYSTEM用） */
  companyIds: string[];
  label?: string;
}

/** email → LCC COMMAND User の対応表。Phase B0は設定由来、将来はSheets管理も可 */
export type UserDirectory = Record<string, UserDirectoryEntry>;

export function principalFromIdentity(
  identity: VerifiedIdentity,
  directory: UserDirectory
): Principal | null {
  const entry = directory[identity.email.toLowerCase()];
  if (!entry) return null; // 未登録Googleアカウントは認証済みでも認可しない
  return {
    role: entry.role,
    companyIds: entry.companyIds.includes('*') ? [] : entry.companyIds,
    label: entry.label ?? identity.email
  };
}

export class GoogleIdentityAuthenticator {
  constructor(
    private readonly verifier: IdTokenVerifier,
    private readonly directory: UserDirectory
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<Principal | null> {
    const token = (authorizationHeader ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    const identity = await this.verifier.verify(token);
    if (!identity) return null;
    return principalFromIdentity(identity, this.directory);
  }
}

/**
 * 環境変数から構築する。
 * LCC_GOOGLE_AUDIENCE: OAuthクライアントID（audience検証用）
 * LCC_COMMAND_USERS: {"email":{"role":"PRESIDENT","companyIds":["*"]}} のJSON
 */
export function createGoogleAuthenticatorFromEnv(
  env = process.env
): GoogleIdentityAuthenticator | null {
  const audience = env.LCC_GOOGLE_AUDIENCE;
  const usersJson = env.LCC_COMMAND_USERS;
  if (!audience || !usersJson) return null;
  try {
    const directory = Object.fromEntries(
      Object.entries(JSON.parse(usersJson) as UserDirectory).map(([email, entry]) => [
        email.toLowerCase(),
        entry
      ])
    );
    return new GoogleIdentityAuthenticator(new GoogleTokenInfoVerifier(audience), directory);
  } catch {
    return null; // 設定破損はフェイルクローズ
  }
}
