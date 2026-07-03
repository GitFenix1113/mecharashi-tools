import type { ChangelogMonth } from './types'

const jul2026: ChangelogMonth = {
  month: '2026-07',
  entries: [
    { date: '2026-07-04', type: 'feat', summary: '技能新增「額外打擊」分類（以特定武器發動的追加打擊，如「越界追獵」），機師詳情頁與後台可顯示與編輯' },
    { date: '2026-07-04', type: 'feat', summary: '機師與機甲圖鑑新增「緊湊／詳細」檢視切換，預設緊湊（頭像+名）更省空間；登入後會記住各頁的檢視偏好，下次自動套用' },
    { date: '2026-07-04', type: 'feat', summary: '技能新增「PP技能」分類（消耗 PP 的技能，如「勇氣」），機師詳情頁與後台可顯示與編輯 PP 消耗' },
    { date: '2026-07-04', type: 'feat', summary: '元件圖鑑頁新增「元件掉落總表」快速連結，方便查看各關 BOSS 掉落' },
    { date: '2026-07-04', type: 'feat', summary: '攻略頁新增「元件掉落總表」：可切換觸/應元件分頁、以圖示呈現各關 BOSS 掉落的元件，並可一鍵匯出成圖片' },
    { date: '2026-07-03', type: 'feat', summary: '管理後台新增「新增機師」功能，並可完整編輯神經驅動分區（插槽、各級算力門檻、連結能力庫），技能亦可標記為「初始被動能力」' },
    { date: '2026-07-03', type: 'style', summary: '機師詳情頁「職業技能」正名為「初始被動能力」；神經驅動「暴擊」晶片正確顯示為藍色' },
    { date: '2026-07-03', type: 'feat', summary: '元件圖鑑新增「子類型」篩選，並移除觸發條件篩選' },
    { date: '2026-07-03', type: 'feat', summary: '元件的 Boss 掉落關卡改為可於後台編輯（原為固定資料）' },
    { date: '2026-07-02', type: 'style', summary: '機師神經驅動分頁的插槽改用顏色方塊標示晶片類型（紅=Attack／黃=Dodge／藍=Critical），並附色彩圖例' },
    { date: '2026-07-02', type: 'feat', summary: '背包、模組、元件的效果描述支援引用懸浮視窗，可查看連結的 BUFF／技能等詳情' },
    { date: '2026-07-02', type: 'feat', summary: '導覽列新增英文版友站「Mecharashi Wiki」連結（桌機右上角、手機收於「更多」面板）' },
  ],
}

export default jul2026
