// ── 陣營徽章註記 factionEmblems（PLAN-042-F）──────────────────────────────────
//
// 文件 ID＝徽章編號 4 碼（'0025'）；欄位意義見 src/types/factionEmblem.ts。
//
// ⚠ 刻意**不登記進 entityRefs SPECS**、也**不走 saveWithHistory**：
//   · 註記不引用別人、也不被任何 [xxx] 引用——沒有級聯要跑。
//   · 一旦進 SPECS，級聯刪除與「影響 N 處引用」掃描會自動連帶讀這個集合；
//     rules 晚一步部署的話，全站既有的刪除功能會一起 permission-denied（PLAN-042-A 踩過）。
//   · saveWithHistory 的 ChangeTargetKind 綁著 SPECS（entityRefs 的 SPEC_COLL_OF 是窮舉 Record），
//     要稽核記錄就得先進 SPECS。註記是幾個字的短文、寫壞了重填即可，不值得拉這條連動。
//   所以寫入就是 writeDoc＋bump，同 pilots／modules。

import type { FactionEmblem } from '../../types'
import { fetchCollection, writeDoc } from './firestoreCore'
import { bumpDataVersion } from './versions'

const COLL = 'factionEmblems'

export const getFactionEmblems = () => fetchCollection<FactionEmblem>(COLL)

/** 寫入／更新一顆徽章的註記（整份覆寫）。呼叫端先過 utils/factionEmblems 的 normalizeEmblem。 */
export const updateFactionEmblem = async (emblem: FactionEmblem): Promise<string> => {
  const { id, ...data } = emblem
  await writeDoc(COLL, id, data)
  return bumpDataVersion(COLL).catch(() => '')
}
