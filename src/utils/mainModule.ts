import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ESMメインモジュール判定（検収是正⑤）。
 * 旧実装の `import.meta.url === `file://${process.argv[1]}`` は、Windowsでは
 * argv[1] が `C:\...` 形式・import.meta.url が `file:///C:/...` 形式となり常に不成立で、
 * serve() が呼ばれずプロセスがexit 0していた。
 * pathToFileURL(resolve(...)) を通すことでWindows・Unix双方のパス形式で成立する。
 * テスト等からimportされた場合（argv[1]が別ファイル・未定義）はfalseを返し、勝手にlistenしない。
 */
export function isMainModule(
  metaUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (argv1 === undefined) {
    return false;
  }
  return metaUrl === pathToFileURL(resolve(argv1)).href;
}
