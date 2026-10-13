/**
 * 故事館立繪的 per-pilot 調整表（從元件檔拆出：元件檔只准 export 元件，
 * 否則 Vite 的 fast refresh 對整個檔案失效 —— react-refresh/only-export-components）。
 *
 * 查表鍵是 **pilotArtDir(pilot)（圖片資料夾名）**，不是機師的顯示名稱——PLAN-054 D-2 起就是遊戲 ID（例：'10103107'）。
 *
 * PLAN-042-C 把線稿換成透明底墨線後重看過原本「高光超標」的樣本
 * （零／戰部渡／卡米拉／虎王／凱登）：濾鏡輸出只留邊緣，平面高光不再是白色負片，
 * 全部可用，故不必關線稿；之後真有需要關掉某位的線稿再加 `lineArt: false`。
 */
export interface LoreArtTuning {
  /** false ＝ 不掛線稿層、只淡入 */
  lineArt?: boolean
  /**
   * 舞台上立繪站哪一側（PLAN-042-D B-4）。依人物朝向決定，讓角色「看向」正文；沒寫＝左。
   * 官網 8 位一律左（官方名字層的構圖是為左側做的），寫了也不生效。
   */
  side?: 'left' | 'right'
}

export const LORE_ART_TUNING: Record<string, LoreArtTuning> = {
  // 2026-10-13 模擬頁調過的：看向左邊的放右側
  '10103174': { side: 'right' }, // 海莉絲
  '10103175': { side: 'right' }, // 尼爾
  '10103150': { side: 'right' }, // 零
}
