import { describe, expect, it } from 'vitest';
import {
  GoogleIdentityAuthenticator,
  principalFromIdentity,
  validateIdentity,
  type IdTokenVerifier,
  type VerifiedIdentity
} from '../../../src/command/auth/googleIdentity.js';
import { createCommandApp } from '../../../src/command/server/routes.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const DIRECTORY = {
  'shacho@lcc55.com': { role: 'PRESIDENT' as const, companyIds: ['*'], label: '社長' },
  'kanri-wel@lcc55.com': { role: 'MANAGER' as const, companyIds: ['wel'], label: '福祉管理者' }
};

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    email: 'shacho@lcc55.com',
    audience: 'lcc-client-id',
    expiresAt: FUTURE,
    emailVerified: true,
    ...overrides
  };
}

class StaticVerifier implements IdTokenVerifier {
  constructor(private readonly map: Record<string, VerifiedIdentity>) {}
  async verify(idToken: string): Promise<VerifiedIdentity | null> {
    const found = this.map[idToken];
    if (!found) return null;
    return validateIdentity(found, 'lcc-client-id') ? found : null;
  }
}

describe('B0: Google Identity（Authentication ≠ Authorization）', () => {
  it('IDトークン検証: audience不一致・期限切れ・未検証メールは拒否する', () => {
    expect(validateIdentity(identity(), 'lcc-client-id')).toBe(true);
    expect(validateIdentity(identity({ audience: 'other-app' }), 'lcc-client-id')).toBe(false);
    expect(validateIdentity(identity({ expiresAt: 1 }), 'lcc-client-id')).toBe(false);
    expect(validateIdentity(identity({ emailVerified: false }), 'lcc-client-id')).toBe(false);
  });

  it('Googleアカウント → LCC User → Role/Scope へマッピングする', () => {
    const principal = principalFromIdentity(identity(), DIRECTORY)!;
    expect(principal.role).toBe('PRESIDENT');
    expect(principal.label).toBe('社長');
    // 認証成功でもディレクトリ未登録なら認可しない
    expect(
      principalFromIdentity(identity({ email: 'stranger@example.com' }), DIRECTORY)
    ).toBeNull();
  });

  it('API統合: Google認証でもRBAC（認可）は既存ロジックのまま強制される', async () => {
    const verifier = new StaticVerifier({
      'token-president': identity(),
      'token-wel': identity({ email: 'kanri-wel@lcc55.com' })
    });
    const authenticator = new GoogleIdentityAuthenticator(verifier, DIRECTORY);
    const app = createCommandApp({
      repository: new InMemoryCommandRepository(),
      googleAuthenticator: authenticator
    });

    // 有効トークン → 200
    const ok = await app.request('/kpi?scope=group', {
      headers: { authorization: 'Bearer token-president' }
    });
    expect(ok.status).toBe(200);

    // 無効トークン → 401
    const bad = await app.request('/kpi?scope=group', {
      headers: { authorization: 'Bearer bogus' }
    });
    expect(bad.status).toBe(401);

    // 認証は通るが認可はRBACで遮断（MANAGER(wel)がgroup → 403）
    const denied = await app.request('/kpi?scope=group', {
      headers: { authorization: 'Bearer token-wel' }
    });
    expect(denied.status).toBe(403);
    const allowed = await app.request('/kpi?scope=wel', {
      headers: { authorization: 'Bearer token-wel' }
    });
    expect(allowed.status).toBe(200);
  });
});
