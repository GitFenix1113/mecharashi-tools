// PLAN-042-F：陣營徽章註記的純函式
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emblemCatalog, emblemName, emblemTitle, emblemUsage, emblemsById, factionValues, isNamed, matchEmblem,
  normalizeEmblem, rankEmblems, suggestedEmblemNums,
} from './factionEmblems.ts'

const KEYS = ['Icon_logo_0009_00', 'Icon_logo_0009_01', 'Icon_logo_0012_00', 'Icon_logo_0012_01', 'Icon_logo_0021_01', 'Icon_logo_0025_00', 'Icon_logo_0025_01']
const EMBLEMS = [
  { id: '0025', name: '晨星同盟防衛軍', nameEn: 'DAWNSTAR LEAGUE ARMORED FORCE', inscription: 'DAWNSTAR LEAGUE ARMORED FORCE · DEPARTMENT OF THE DEFENCE FORCE', factions: ['晨星同盟'] },
  { id: '0012', name: '黑曜石集團', inscription: 'OBSIDIAN' },
  { id: '0009', nameEn: 'EELS' },
  { id: '0021', note: '多爾集團？D 字' },
  { id: '0099', name: '圖庫裡沒有這顆' },
]

test('目錄以圖庫為準：DB 多出來的編號忽略、沒有註記的照樣列出', () => {
  const cat = emblemCatalog(KEYS, EMBLEMS)
  assert.deepEqual(cat.map((e) => e.num), ['0009', '0012', '0021', '0025'])
  assert.equal(isNamed(cat.find((e) => e.num === '0009')!), false, '只有英文名不算命名（選圖器排在未命名）')
  assert.equal(cat.find((e) => e.num === '0021')?.color, 'Icon_logo_0021_01')
  assert.equal(cat.find((e) => e.num === '0021')?.mono, undefined)
  assert.equal(isNamed(cat.find((e) => e.num === '0021')!), false, '只有備註不算命名')
  assert.equal(isNamed(cat.find((e) => e.num === '0025')!), true)
})

test('名稱：任一變體都查得到，沒名稱回 undefined', () => {
  const byId = emblemsById(EMBLEMS)
  assert.equal(emblemName('Icon_logo_0025_00', byId), '晨星同盟防衛軍')
  assert.equal(emblemName('Icon_logo_0025_01', byId), '晨星同盟防衛軍')
  assert.equal(emblemName('Icon_logo_0021_01', byId), undefined)
  assert.equal(emblemName('Icon_logo_0009_00', byId), undefined, '只有英文名不算有名稱')
  assert.equal(emblemName('not-a-logo', byId), undefined)
})

test('提示稱呼：中文・英文，只有一個就用那一個', () => {
  const byId = emblemsById(EMBLEMS)
  assert.equal(emblemTitle('Icon_logo_0025_00', byId), '晨星同盟防衛軍・DAWNSTAR LEAGUE ARMORED FORCE')
  assert.equal(emblemTitle('Icon_logo_0012_01', byId), '黑曜石集團')
  assert.equal(emblemTitle('Icon_logo_0009_01', byId), 'EELS')
  assert.equal(emblemTitle('Icon_logo_0021_01', byId), undefined)
})

test('搜尋：數字比編號、文字比名稱／字樣／陣營文字／備註', () => {
  const cat = emblemCatalog(KEYS, EMBLEMS)
  const hits = (q: string) => cat.filter((e) => matchEmblem(e, q)).map((e) => e.num)
  assert.deepEqual(hits('25'), ['0025'])
  assert.deepEqual(hits('0012'), ['0012'])
  assert.deepEqual(hits('黑曜石'), ['0012'])
  assert.deepEqual(hits('dawnstar'), ['0025'], '英文不分大小寫')
  assert.deepEqual(hits('eels'), ['0009'], '英文名也算')
  assert.deepEqual(hits('defence'), ['0025'], '圖上字樣也算')
  assert.deepEqual(hits('晨星同盟'), ['0025'], '對應的陣營文字也算')
  assert.deepEqual(hits('多爾'), ['0021'], '備註也算')
  assert.equal(hits('').length, 4)
  assert.equal(hits('  ').length, 4)
})

test('建議：對應文字完全相同＋同陣營機師已選；排序 建議 → 已命名 → 未命名', () => {
  const cat = emblemCatalog(KEYS, EMBLEMS)
  const s1 = suggestedEmblemNums(' 晨星同盟 ', cat)
  assert.deepEqual([...s1], ['0025'], '對應的陣營文字')
  assert.deepEqual([...suggestedEmblemNums('黑曜石集團', cat)], ['0012'], '名稱和陣營文字一字不差也算')
  assert.deepEqual([...suggestedEmblemNums('晨星', cat)], [], '不做部分比對——那是站長的判斷')
  const s2 = suggestedEmblemNums('北陸聯合', cat, [{ logos: ['Icon_logo_0009_01'], pilots: ['某人'] }])
  assert.deepEqual([...s2], ['0009'])
  assert.deepEqual(rankEmblems(cat, s2).map((e) => e.num), ['0009', '0012', '0025', '0021'])
  assert.deepEqual(rankEmblems(cat).map((e) => e.num), ['0012', '0025', '0009', '0021'])
})

test('使用中：任一變體都算、同一人兩個變體只算一次、亂寫的值忽略', () => {
  const usage = emblemUsage([
    { id: 'a', factionLogos: ['Icon_logo_0025_00'] },
    { id: 'b', factionLogos: ['Icon_logo_0025_01', 'Icon_logo_0012_00'] },
    { id: 'c', factionLogos: ['Icon_logo_0025_00', 'Icon_logo_0025_01'] },
    { id: 'd', factionLogos: 'Icon_logo_0025_00' },
    { id: 'e' },
  ])
  assert.deepEqual(usage.get('0025'), ['a', 'b', 'c'])
  assert.deepEqual(usage.get('0012'), ['b'])
  assert.equal(usage.get('0009'), undefined)
})

test('存檔前整理：trim、丟空值、陣營文字去重；全空只剩 id', () => {
  assert.deepEqual(
    normalizeEmblem({ id: '0025', name: ' 晨星同盟防衛軍 ', nameEn: ' DAWNSTAR ', inscription: '', factions: ['晨星同盟', ' 晨星同盟 ', '', '晨星同盟防衛軍'], note: '  ' }),
    { id: '0025', name: '晨星同盟防衛軍', nameEn: 'DAWNSTAR', factions: ['晨星同盟', '晨星同盟防衛軍'] },
  )
  assert.deepEqual(normalizeEmblem({ id: '0009', name: ' ', factions: [' '] }), { id: '0009' })
})

test('現有陣營文字：去重、人數多的在前', () => {
  assert.deepEqual(
    factionValues([{ faction: '北陸聯合' }, { faction: ' 晨星同盟' }, { faction: '北陸聯合 ' }, { faction: '' }, {}, { faction: '曇' }]),
    ['北陸聯合', '晨星同盟', '曇'],
  )
})
