// PLAN-042-B：機甲的系譜（卷宗「系譜」卡）。純函式，展廳頁與編輯台預覽共用（要能 node --test）。
//
// 一律人工連（決策 B-10）：這裡只組「這台自己連出去的」＋「別台連到這台的」反查，**不做任何文字比對**。
// 自己連出去的用呼叫端給的 relations（展廳＝DB 那份、編輯台預覽＝表單裡正在編的那份）。

import type { Mech, MechLoreDoc, MechRelation, MechRelationKind } from '../../types'

/** 系譜的一條：方向 0＝這台自己連出去的、1＝別台連到這台（反查） */
export interface MechLineageItem {
  mech: Mech
  modelNo?: string
  kind?: MechRelationKind
  dir: 0 | 1
  note?: string
}

/**
 * 先列自己連出去的（陣列順序＝顯示順序），再列反查到的；同一台只出現一次（自己連出去的優先）。
 * 指向已刪掉的機甲、或指向自己的那條略過。
 */
export function buildMechLineage(
  mechId: string,
  relations: readonly MechRelation[] | undefined,
  mechs: readonly Mech[],
  loreDocs: readonly MechLoreDoc[],
): MechLineageItem[] {
  const byId = new Map(mechs.map((m) => [m.id, m]))
  const modelNo = new Map(loreDocs.map((d) => [d.id, d.modelNo]))
  const out: MechLineageItem[] = []
  const seen = new Set<string>([mechId])
  for (const r of relations ?? []) {
    const m = byId.get(r.mechId)
    if (!m || seen.has(m.id)) continue
    seen.add(m.id)
    out.push({ mech: m, modelNo: modelNo.get(m.id), kind: r.kind, dir: 0, note: r.note })
  }
  for (const d of loreDocs) {
    if (d.id === mechId) continue
    for (const r of d.relations ?? []) {
      if (r.mechId !== mechId) continue
      const m = byId.get(d.id)
      if (!m || seen.has(m.id)) continue
      seen.add(m.id)
      out.push({ mech: m, modelNo: modelNo.get(m.id), kind: r.kind, dir: 1, note: r.note })
    }
  }
  return out
}

/** 編輯台存檔前的檢查：沒選機甲、同一台選兩次（空陣列＝沒問題） */
export function relationIssues(rows: readonly MechRelation[] | undefined): string[] {
  const list = rows ?? []
  const issues: string[] = []
  const empty = list.filter((r) => !r.mechId).length
  if (empty) issues.push(`${empty} 條還沒選機甲`)
  const seen = new Set<string>(), dup = new Set<string>()
  for (const r of list) {
    if (!r.mechId) continue
    if (seen.has(r.mechId)) dup.add(r.mechId)
    seen.add(r.mechId)
  }
  if (dup.size) issues.push(`同一台選了兩次：${[...dup].join('、')}`)
  return issues
}

/** 反查：哪些機甲的系譜連到這台（編輯台列給編輯者看，避免兩邊各寫一條方向相反的） */
export function incomingRelations(mechId: string, loreDocs: readonly MechLoreDoc[]): { from: string; relation: MechRelation }[] {
  const out: { from: string; relation: MechRelation }[] = []
  for (const d of loreDocs) {
    if (d.id === mechId) continue
    for (const r of d.relations ?? []) if (r.mechId === mechId) out.push({ from: d.id, relation: r })
  }
  return out
}
