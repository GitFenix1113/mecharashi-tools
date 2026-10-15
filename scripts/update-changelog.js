#!/usr/bin/env node
/**
 * update-changelog.js
 * 自動將 git log 中尚未記錄的 commit 更新至 CHANGELOG.md 的 [Unreleased] 區塊。
 * 僅抓取「最後一個 tag 之後」的 commit；若無 tag，則抓取全部。
 * 自動略過 "chore: update CHANGELOG" 類的 commit，避免循環。
 *
 * ⚠ [Unreleased] 區塊是「每次從 git log 整段重建」而不是增量追加（repo 目前沒有 tag，
 * 等於每次都讀全部歷史）。所以 git log 少看到幾筆，CHANGELOG.md 就少幾筆。
 * 雲端 session 是淺層 clone（約 50 筆歷史），因此被截斷過兩次：dc4b5bc 砍掉 473 行、
 * 4ec19c7 砍掉 497 行（16cf01b 還原）。下面兩道防線都是為了這件事，失敗時一律 exit 1、不寫檔，
 * 讓 pre-push hook / npm run push 中止推送。
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const CHANGELOG_PATH = 'CHANGELOG.md';

// 防線 2：新檔比舊檔少超過這麼多行就視為截斷。正常情況只會變長；
// 會變短的只有「已記錄的 commit 後來被 rebase/amend 掉」，一筆一行，不會一次少到這個量。
const MAX_LOST_LINES = 20;

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function abort(lines) {
  console.error(['', ...lines, ''].join('\n'));
  process.exit(1);
}

// 防線 1：淺層 clone 的 git log 不完整，直接拒絕執行。
// 不自動 git fetch --unshallow：那是一次看不見大小的下載，放在 hook 裡默默跑不妥。
function assertNotShallow() {
  let shallow = 'false';
  try {
    shallow = run('git rev-parse --is-shallow-repository');
  } catch {
    // git < 2.15 沒有這個選項；交給防線 2 把關
  }
  if (shallow === 'true') {
    abort([
      '❌  這是淺層 clone（git 歷史不完整），已中止更新 CHANGELOG.md。',
      '    update-changelog.js 會用 git log 重建整段 [Unreleased]，',
      '    歷史不完整就會把看不到的舊紀錄全部刪掉。',
      '',
      '    請先補齊歷史再重新 push：',
      '        git fetch --unshallow origin',
    ]);
  }
}

// 取得待記錄的 commit 清單
function getNewCommits() {
  let range = 'HEAD';
  try {
    const lastTag = run('git describe --tags --abbrev=0');
    range = `${lastTag}..HEAD`;
  } catch {
    // 無 tag，取全部 commit
  }

  const output = run(
    `git log ${range} --pretty=format:"%H|%s|%aI" --no-merges`
  );
  if (!output) return [];

  return output
    .split('\n')
    .map((line) => {
      const firstBar = line.indexOf('|');
      const secondBar = line.indexOf('|', firstBar + 1);
      const hash = line.slice(0, firstBar);
      const subject = line.slice(firstBar + 1, secondBar);
      const date = line.slice(secondBar + 1).split('T')[0];

      // 略過 changelog 更新本身產生的 commit
      if (/^chore.*CHANGELOG/i.test(subject)) return null;

      const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)/);
      return {
        hash,
        subject,
        date,
        type: match ? match[1] : 'other',
        scope: match ? match[2] || null : null,
        breaking: match ? !!match[3] : false,
        description: match ? match[4] : subject,
      };
    })
    .filter(Boolean);
}

// 格式化單行 commit
function formatLine(c) {
  const scope = c.scope ? `**${c.scope}**: ` : '';
  const shortHash = c.hash.substring(0, 7);
  return `- ${scope}${c.description} (\`${shortHash}\`)`;
}

// 依 type 分組後輸出 Markdown
function formatCommits(commits) {
  const typeLabels = {
    feat:     '✨ 新功能',
    fix:      '🐛 修復',
    perf:     '⚡ 效能優化',
    refactor: '♻️ 重構',
    data:     '📊 資料更新',
    docs:     '📚 文件',
    style:    '🎨 樣式',
    test:     '🧪 測試',
    chore:    '🔧 維護',
    ci:       '🚀 CI/CD',
    revert:   '⏪ 還原',
    other:    '其他',
  };

  const groups = {};
  const breaking = [];

  for (const c of commits) {
    if (c.breaking) {
      breaking.push(c);
      continue;
    }
    const key = typeLabels[c.type] ? c.type : 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  let result = '';

  if (breaking.length) {
    result += `### ⚠ 重大變更\n\n`;
    result += breaking.map(formatLine).join('\n') + '\n\n';
  }

  const order = [
    'feat', 'fix', 'perf', 'refactor', 'data',
    'docs', 'style', 'test', 'chore', 'ci', 'revert', 'other',
  ];
  for (const type of order) {
    if (groups[type]?.length) {
      result += `### ${typeLabels[type]}\n\n`;
      result += groups[type].map(formatLine).join('\n') + '\n\n';
    }
  }

  return result.trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

assertNotShallow();

const commits = getNewCommits();
const today = new Date().toISOString().split('T')[0];

// 組出新的 [Unreleased] 區塊
let unreleasedSection =
  `## [Unreleased] - ${today}\n\n` +
  (commits.length > 0
    ? formatCommits(commits) + '\n'
    : '_暫無未發布的變更_\n') +
  '\n---\n';

// 讀取現有 CHANGELOG.md（或建立預設 header）
let content = '';
if (existsSync(CHANGELOG_PATH)) {
  content = readFileSync(CHANGELOG_PATH, 'utf8');
} else {
  content =
    '# Changelog\n\n' +
    '所有重要變更將記錄於此文件。\n\n' +
    '格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，' +
    '版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。\n\n';
}

// 以 "## [" 為分割點拆解文件
const parts = content.split(/(?=^## \[)/m);
const unreleasedIdx = parts.findIndex((p) => p.startsWith('## [Unreleased]'));

if (unreleasedIdx !== -1) {
  parts[unreleasedIdx] = unreleasedSection;
} else {
  // 插在第一個版本區塊之前
  const firstVersionIdx = parts.findIndex((p) => /^## \[\d/.test(p));
  if (firstVersionIdx !== -1) {
    parts.splice(firstVersionIdx, 0, unreleasedSection);
  } else {
    // 文件完全沒有任何區塊，直接附加
    parts.push(unreleasedSection);
  }
}

const nextContent = parts.join('');

const countLines = (s) => s.split('\n').length;
const lostLines = countLines(content) - countLines(nextContent);
if (lostLines > MAX_LOST_LINES) {
  abort([
    `❌  新的 CHANGELOG.md 會比現在少 ${lostLines} 行（${countLines(content)} → ${countLines(nextContent)}），`,
    '    看起來是 git log 讀到的歷史不完整，已中止、未寫入。',
    '',
    '    可能原因：',
    '      - 淺層 clone / 部分歷史：git fetch --unshallow origin',
    '      - 新打了 tag 但沒先把 [Unreleased] 改名成該版本區塊',
  ]);
}

writeFileSync(CHANGELOG_PATH, nextContent, 'utf8');
console.log(
  `✅  CHANGELOG.md 已更新（${commits.length} 筆 commit，${today}）`
);
