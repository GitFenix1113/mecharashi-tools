/**
 * npm run push —— 一次把 CHANGELOG.md 連同本次變更推完。
 *
 * 為什麼需要這支而不是直接 git push：
 *   pre-push hook 也會更新 CHANGELOG.md 並 commit，但那筆 commit 產生時，
 *   git 早就鎖定了本次 push 的 compare-and-swap 期望值 —— 它進不了這一次推送，
 *   只能等下次 push 順便帶走（症狀：push 完 git status 顯示 ahead 1）。
 *   hook 內若自己補推一次，外層 push 會被 remote 以 cannot lock ref 拒絕
 *   （東西有上去，但指令 exit 1）。實測過，見 .githooks/pre-push 的註解。
 *
 * 解法是順序而不是技巧：**先**把 CHANGELOG commit 做出來，**再**開始 push。
 * 這樣它天然落在推送範圍內。hook 屆時會再跑一次 update-changelog.js，
 * 發現無變動就不 commit，正常放行。
 */
import { execFileSync } from 'node:child_process'

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts })

const git = (...args) => run('git', args).trim()

// 轉推給 git push 的旗標（npm run push -- --force-with-lease 之類）
const passthrough = process.argv.slice(2)

console.log('🔄  更新 CHANGELOG.md ...')
run('node', ['scripts/update-changelog.js'], { stdio: 'inherit' })

if (git('status', '--porcelain', 'CHANGELOG.md')) {
  // commit 訊息沿用 hook 的格式：帶上本次要推的第一筆 commit 摘要，
  // 這樣 log 上看得出這份 CHANGELOG 是為了哪次變更而更新的。
  let subject = 'chore: 自動更新 CHANGELOG.md'
  let body = ''
  try {
    const pending = git('log', '@{upstream}..HEAD', '--pretty=format:%s', '--no-merges')
      .split('\n')
      .filter(s => s && !/^chore.*CHANGELOG/.test(s))
      .slice(0, 10)
    if (pending.length) {
      subject += ` — ${pending[0]}`
      body = `包含：\n${pending.map(s => `- ${s}`).join('\n')}`
    }
  } catch {
    // 沒有 upstream（第一次推新分支）——訊息退回不帶摘要的版本即可，不是錯誤
  }

  git('add', 'CHANGELOG.md')
  run('git', body ? ['commit', '-m', subject, '-m', body] : ['commit', '-m', subject])
  console.log('📝  CHANGELOG.md 已 commit，將與本次變更一併推送。')
} else {
  console.log('✅  CHANGELOG.md 無變動。')
}

console.log('🚀  git push ...')
// stdio: inherit —— push 的進度、hook 的 build 輸出都要即時看得到；
// 失敗時讓 git 自己的 exit code 傳出去，不要吞掉。
run('git', ['push', ...passthrough], { stdio: 'inherit' })
