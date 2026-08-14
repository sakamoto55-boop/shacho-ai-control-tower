import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // グローバルignore（他のキーと同居させると対象ファイル限定になるため単独オブジェクトにする）
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'prettier.config.cjs', 'docs/vendor/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  // Cloud Run relay（Node実行・依存ゼロmjs）: Nodeグローバルを許可
  {
    files: ['cloudrun/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly'
      }
    }
  }
);
