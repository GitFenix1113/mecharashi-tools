import type { PatchVersion } from './types'

const v2_8: PatchVersion = {
  version: '2.8',
  bannerImage: '/images/banners/v2.8.webp',
  upper: {
    cnDate: '2025/11/06',
    twDate: '2026/04/23',
    pilots: ['鄭樂萱'],
    mechs: ['霸王（中甲）'],
    mechSelection: ['疾嘯', '芬里厄', '遊騎兵', '龍雀', '海拉', '赫拉克斯', '格萊楊'],
    armamentRaids: [
      { name: '帕洛瑪', weapons: ['焰刀'] },
      { name: '維護者', backpacks: ['修理型背包'] },
    ],
    battlePass: { pilots: ['阿黛勒', '懷亞特'], mechs: ['影武者', '芬里厄'] },
    cnActivities: [
      { name: '角雕刮刮樂', startDate: '2025/11/13', weeks: 2, type: 'skinGacha' },
      { name: '角雕特遣',   startDate: '2025/11/20', weeks: 1, type: 'pilotMission', pilots: ['白夜凍鋒', '十字線上的明光'] },
      { name: '環島物流節', startDate: '2025/11/20', weeks: 2, type: 'limitedEvent' },
    ],
    twActivities: [
      { name: '角雕刮刮樂', startDate: '2026/04/30', weeks: 2, type: 'skinGacha' },
      { name: '角雕特遣',   startDate: '2026/05/07', weeks: 1, type: 'pilotMission', pilots: ['白夜凍鋒', '十字線上的明光'] },
      { name: '環島物流節', startDate: '2026/05/07', weeks: 2, type: 'limitedEvent' },
    ],
  },
  lower: {
    cnDate: '2025/11/27',
    twDate: '2026/05/14',
    pilots: ['奧德莉'],
    mechs: ['君權（重甲）'],
    armamentRaids: [
      { name: '安德森', weapons: ['玲瓏'] },
      { name: '縱火者', backpacks: ['彈藥型背包'] },
      { name: '鐵幕法典' },
    ],
    rouletteEvent: true,
    cnActivities: [
      { name: '角雕輪盤', startDate: '2025/12/18', weeks: 1, type: 'roulette' },
    ],
    twActivities: [
      { name: '角雕輪盤', startDate: '2026/05/28', weeks: 1, type: 'roulette' },
    ],
  },
  crisisShop: ['亞瑟', '梅利莎'],
  isTwCurrent: true,
}

export default v2_8
