/**
 * LoreArt 的 per-pilot 顯影退路表（從 LoreArt.tsx 拆出：元件檔只准 export 元件，
 * 否則 Vite 的 fast refresh 對整個檔案失效 —— react-refresh/only-export-components）。
 *
 * 查表鍵是 **pilotArtDir(pilot)（圖片資料夾名）**，不是機師的顯示名稱——PLAN-054 D-2 起就是遊戲 ID（例：'10103107'）。
 *
 * PLAN-042-C 把線稿換成透明底墨線後重看過原本「高光超標」的樣本
 * （零／戰部渡／卡米拉／虎王／凱登）：濾鏡輸出只留邊緣，平面高光不再是白色負片，
 * 全部可用，故清空退路表；之後真有需要關掉某位的線稿再加回來。
 */
export interface LoreArtTuning {
  /** false ＝ 不掛線稿層、只淡入 */
  lineArt?: boolean
}

export const LORE_ART_TUNING: Record<string, LoreArtTuning> = {}
