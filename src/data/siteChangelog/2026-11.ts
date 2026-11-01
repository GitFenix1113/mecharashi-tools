import type { ChangelogMonth } from './types'

const nov2026: ChangelogMonth = {
  month: '2026-11',
  entries: [
    { date: '2026-11-02', type: 'fix', summary: '武裝討伐：首領面板的軀幹耐久補上首領背包的加成，先前少算約 5%～13%'
      + '（第 2 期第 3 關、第 3 期第 3 關、第 11 期第 2 關、第 13 期第 1 關、第 18 期第 2 關，共 18 隻首領；已與遊戲內截圖核對）。' },
    { date: '2026-11-01', type: 'feat', summary: '後台新增「<b>傷害模擬驗證台</b>」（管理員限定，<b>/admin/sim</b>）：貼上配裝、選武裝討伐首領，'
      + '把模擬預測與遊戲內的預覽數字、實際跳字並排比對，超出容許範圍的項目會標出來，並列出沒有計入的效果；比對結果可匯出成案例檔。' },
  ],
}

export default nov2026
