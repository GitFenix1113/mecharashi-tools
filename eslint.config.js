import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude/：Claude Code 的 worktree 會在 .claude/worktrees/ 下放一整份 repo 副本，
  // 掃進去就出現第二個 tsconfig 根目錄、全部檔案一起 parsing error（2026-10-14 lint 從 89 跳到 1023）
  globalIgnores(['dist', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
