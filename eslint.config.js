import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // 全局忽略：构建产物、WXT 生成目录、词库数据、缓存
  {
    ignores: [
      '.output/',
      '.wxt/',
      'dist/',
      'node_modules/',
      'public/dictionaries/',
      'scripts/build-dictionary/.cache/',
      '.npm-cache/',
    ],
  },

  // 基础规则
  js.configs.recommended,

  // TypeScript 规则
  ...tseslint.configs.recommended,

  // Node 脚本（.mjs/.cjs 配置与构建脚本）
  {
    files: ['**/*.{mjs,cjs}', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // React 入口（.tsx/.ts 在 src/ 与 tests/ 下）
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // 允许以 _ 前缀标记故意未使用的参数与变量
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // 关闭与 Prettier 冲突的格式化规则
  prettier,
);
