import type { PatchVersion } from './types'

const v3_0: PatchVersion = {
  version: '3.0',
  bannerImage: '/images/banners/v3.0.webp',
  upper: {
    cnDate: '2026/01/01',
    twDate: '2026/06/04',
    pilots: ['海莉絲'],
    mechs: ['彌造者（輕甲）'],
    armamentRaids: [
      { name: '羅斯瑪麗', weapons: ['否決'] },
      { name: '絕殺者', backpacks: ['隱形首包'] },
    ],
    battlePass: { pilots: ['艾達', '薩普里姬'], mechs: ['疾嘯', '雪鴿'] },
  },
  lower: {
    cnDate: '2026/01/22',
    twDate: '約 2026/06/25',
    twIsPredicted: true,
    pilots: ['瑪阿特'],
    mechs: ['殉道士（中甲）'],
    pilotSelection: ['艾達', '薩普里姬'],
    armamentRaids: [
      { name: '薩普里里姬', weapons: ['函'] },
      { name: '斷火者', backpacks: ['誘導傷背包'] },
    ],
  },
  borderShop: '雷克斯(6/15)',
  arenaShop: '銀閃(6/18)',
  grayOpsUpdates: [
    { company: '武裝工坊', newMechs: ['霸王'] },
    { company: '創新動力', newMechs: ['幻惑'] },
    { company: 'GeekX', newMechs: ['夜天光'] },
  ],
}

export default v3_0
