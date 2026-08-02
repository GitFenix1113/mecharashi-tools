import type { ChangelogMonth } from './types'

const aug2026: ChangelogMonth = {
  month: '2026-08',
  entries: [
    { date: '2026-08-02', type: 'feat', summary: '同一段描述裡出現兩個同名的方括號詞時，現在可以各自連到不同的東西。例如天賦寫「可使用指令[駐陣]…若處於[駐陣]狀態」，前面那個是技能、後面那個是狀態（BUFF），點下去會分別開出正確的詳情；畫面上看到的字完全不變，仍是 [駐陣]' },
    { date: '2026-08-02', type: 'fix', summary: '描述中的方括號詞若尚未指派引用，不再有機會把內部標記外露到畫面上（差異對比開啟與關閉時的顯示也保持一致）' },
  ],
}

export default aug2026
