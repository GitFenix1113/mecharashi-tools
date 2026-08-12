import type { DescriptionRefs, ModuleLevel } from '../../types'

/**
 * 取某一等級的 `descriptionRefs`，**未設定或設成空物件時回傳 undefined**，
 * 讓呼叫端用 `?? mod.descriptionRefs` 回退到父模組。
 *
 * 直接寫 `lv.descriptionRefs ?? mod.descriptionRefs` 會漏掉空物件那一格：後台在某一級
 * 存過一次空 refs（例如清掉最後一個指派）之後，該級就再也不會回退，整張卡的 chip 全滅——
 * 而畫面症狀與「還沒指派」一模一樣（不報錯、只是不亮），沒人會知道是存檔造成的。
 */
export function levelRefs(level?: ModuleLevel): DescriptionRefs | undefined {
  const refs = level?.descriptionRefs
  return refs && Object.keys(refs).length > 0 ? refs : undefined
}
