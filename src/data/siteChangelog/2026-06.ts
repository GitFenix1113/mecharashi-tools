import type { ChangelogMonth } from './types'

const jun2026: ChangelogMonth = {
  month: '2026-06',
  entries: [
    { date: '2026-06-03', type: 'refactor', summary: '管理後台版本前瞻圖上傳改用 Cloudinary（與頭像上傳一致），並支援前瞻圖以遠端網址正常顯示' },
    { date: '2026-06-03', type: 'feat', summary: '版本時間線改為焦點輪播設計：可用滾輪或方向鍵切換版本，點擊中央項目開啟詳情' },
    { date: '2026-06-03', type: 'feat', summary: '版本詳情頁新增台版／陸版一鍵切換按鈕' },
    { date: '2026-06-03', type: 'style', summary: '版本詳情甘特圖改為固定內容與活動甘特分離的雙表格版面，欄位對齊並放大字體；邊境商店／鬥技場改為左右並列顯示' },
    { date: '2026-06-01', type: 'fix', summary: '修正版本資訊頁機師／武器／背包圖示因路徑格式不一致導致無法顯示的問題' },
    { date: '2026-06-01', type: 'fix', summary: '更新首頁 Discord 社群邀請連結' },
    { date: '2026-06-01', type: 'feat', summary: 'Email 登入新增忘記密碼與重設密碼信寄送功能' },
    { date: '2026-06-01', type: 'feat', summary: '攻略專區新增「彩甲升級規劃器」工具：輸入持有零件與改進模組，自動規劃最優彩甲升級路線' },
  ],
}

export default jun2026
