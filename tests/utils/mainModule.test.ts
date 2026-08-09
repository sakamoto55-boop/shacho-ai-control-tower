import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMainModule } from '../../src/utils/mainModule.js';

// 検収是正⑤: ESMメインモジュール判定の限定テスト。
// Windowsでは argv[1] が `C:\...`、import.meta.url が `file:///C:/...` となり
// 旧実装（`file://${argv[1]}` 文字列連結）は常に不成立だった。
describe('isMainModule', () => {
  it('argv[1]が実行ファイルと一致する場合はtrue（相対パス指定でも成立）', () => {
    const argv1 = 'dist/server.js';
    const metaUrl = pathToFileURL(resolve(argv1)).href;
    expect(isMainModule(metaUrl, argv1)).toBe(true);
  });

  it('importされた別ファイルの場合はfalse（テストからのimportでlistenしない）', () => {
    const metaUrl = pathToFileURL(resolve('dist/server.js')).href;
    expect(isMainModule(metaUrl, resolve('tests/utils/mainModule.test.ts'))).toBe(false);
  });

  it('argv[1]が未設定の場合はfalse', () => {
    const metaUrl = pathToFileURL(resolve('dist/server.js')).href;
    expect(isMainModule(metaUrl, undefined)).toBe(false);
  });

  it('現在のOSのパス形式でresolve+file URL変換が往復一致する（本テストファイル自身で検証）', () => {
    const selfPath = fileURLToPath(import.meta.url);
    expect(isMainModule(import.meta.url, selfPath)).toBe(true);
  });
});
