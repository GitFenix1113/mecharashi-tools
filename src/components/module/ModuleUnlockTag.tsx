import type { ModuleUnlock } from '../../types'
import { useGameData } from '../../contexts/GameDataContext'

/**
 * 模組的啟用條件標籤（PLAN-058 決策五）。
 *
 * 「※只有[曜]能發動此模組※」原本寫在正文裡，而且只寫在頂層——模組卡顯示的是等級描述，
 * 所以圖鑑上其實從來沒看到過。條件既然已經落在 `unlockCondition`（PLAN-052-K），
 * 就由這裡統一講出來，正文只留效果本身。復仇女神四顆「需〈迸發模組〉滿級」也是這時才第一次在圖鑑出現。
 *
 * 名稱查不到時（該頁沒載入機師）退回 id 去掉流水號前綴，不為一個標籤多抓一整個集合。
 */
export function ModuleUnlockTag({ unlock }: { unlock?: ModuleUnlock }) {
  const gd = useGameData()
  if (!unlock) return null

  let text: string
  if (unlock.kind === 'pilotOnly') {
    const names = unlock.pilotIds
      .map((id) => gd.pilots.find((p) => p.id === id)?.name ?? id.replace(/^pilot_\d+_/, ''))
      .join('、')
    text = `限 ${names} 駕駛時發動`
  } else {
    const name = gd.modules.find((m) => m.id === unlock.moduleId)?.name ?? unlock.moduleId
    text = `需〈${name}〉達 LV.MAX`
  }

  return (
    <span className="text-[12px] px-1.5 py-0.5 rounded bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/30 shrink-0">
      {text}
    </span>
  )
}
