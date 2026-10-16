// ── 機甲廠商 mechMakers（PLAN-042-B 決策 B-8）──────────────────────────────────
//
// 文件 ID＝官方舞台背景鍵（'Doll'、'UKB'…）；欄位意義見 src/types/mechMaker.ts。
//
// ⚠ 刻意**不登記進 entityRefs SPECS**、也**不走 saveWithHistory**，理由同 factionEmblems：
//   · 廠商不引用別人、也不被任何 [xxx] 引用——沒有級聯要跑。
//   · 一旦進 SPECS，級聯刪除與「影響 N 處引用」掃描會自動連帶讀這個集合；
//     rules 晚一步部署的話，全站既有的刪除功能會一起 permission-denied（PLAN-042-A 踩過）。
//   · 都是幾個字的短欄位，寫壞了重填即可，不值得為了稽核記錄拉這條連動。
//   所以寫入就是 writeDoc＋bump，同 factionEmblems。

import type { MechMaker } from '../../types'
import { fetchCollection, writeDoc } from './firestoreCore'
import { bumpDataVersion } from './versions'

const COLL = 'mechMakers'

export const getMechMakers = () => fetchCollection<MechMaker>(COLL)

/** 寫入／更新一家廠商（整份覆寫）。 */
export const updateMechMaker = async (maker: MechMaker): Promise<string> => {
  const { id, ...data } = maker
  await writeDoc(COLL, id, data)
  return bumpDataVersion(COLL).catch(() => '')
}
