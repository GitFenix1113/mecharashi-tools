// 武裝討伐譯名的種類／來源標籤（譯名頁、點字修改、欄位修正共用）

const TERM_KIND_LABEL: Record<string, string> = {
  season: '期名', faction: '勢力', level: '關卡名', battle: '戰場名', unit: '單位／人名', mech: '機體', weapon: '武器',
  backpack: '背包', skill: '技能名', buff: '效果名', terrain: '地形', bounty: '懸賞', clue: '線索名', quote: '台詞',
  ui: '介面用語', text: '說明文字', anecdote: '逸聞',
}
const LONG_KINDS = new Set(['text', 'anecdote', 'quote'])
const SOURCE_LABEL: Record<string, string> = {
  machine: '機轉', manual: '人工', site: '站上既有', timeline: '時間線', infodata: 'infodata', screenshot: '截圖', table: '對照表',
}

export const TERM_KIND_ORDER = Object.keys(TERM_KIND_LABEL)
export const termKindLabel = (kind: string) => TERM_KIND_LABEL[kind] ?? kind
export const termSourceLabel = (source: string) => SOURCE_LABEL[source] ?? source
export const isLongTerm = (kind: string) => LONG_KINDS.has(kind)
