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
  // テスト用mock gcloud（CommonJS・Node実行）: Nodeグローバル+CJS requireを許可
  {
    files: ['tests/command/gcloudps1/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        module: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off'
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
