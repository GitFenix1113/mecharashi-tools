import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Translator, machine, termHash } from './raidI18n.mjs'

const doc = (entries) => ({ entries: Object.fromEntries(entries.map((e) => [termHash(e.cn), e])) })

test('machine：簡→繁＋過度轉換修正（回避不被轉成迴避）', () => {
  assert.equal(machine('武装讨伐'), '武裝討伐')
  assert.equal(machine('回避模组'), '回避模組')
})

test('lookup：對照表已校 > 對照表待校 > 站上既有 > 機轉（待校）', () => {
  const t = new Translator(
    {
      unit: doc([
        { cn: '科斯蒂利亚', tw: '科斯蒂莉亞', status: 'verified', source: 'screenshot' },
        { cn: '卢克', tw: '盧克', status: 'pending', source: 'infodata' },
      ]),
    },
    { mech: new Set(['戴亞斯']) },
  )
  assert.deepEqual(t.lookup('unit', '科斯蒂利亚', 1), { tw: '科斯蒂莉亞', pending: false })
  assert.deepEqual(t.lookup('unit', '卢克', 21), { tw: '盧克', pending: true })
  assert.deepEqual(t.lookup('mech', '戴亚斯', 21), { tw: '戴亞斯', pending: false })
  assert.deepEqual(t.lookup('unit', '皮普', 9), { tw: '皮普', pending: true })
  const pend = t.pendingList().map((p) => `${p.kind}:${p.cn}:${p.source}`).sort()
  assert.deepEqual(pend, ['unit:卢克:infodata', 'unit:皮普:machine'])
})

test('lookup：同一種類同一原文累計次數與出現期數', () => {
  const t = new Translator()
  t.name('unit', '老练佣兵', 21)
  t.name('unit', '老练佣兵', 20)
  t.name('unit', '老练佣兵', 21)
  const [p] = t.pendingList()
  assert.equal(p.count, 3)
  assert.deepEqual(p.seasons, [20, 21])
})

test('text：記號受保護、記號裡的名稱另外查表、對照表名詞先替換', () => {
  const t = new Translator({
    unit: doc([{ cn: '科斯蒂利亚', tw: '科斯蒂莉亞', status: 'verified' }]),
    buff: doc([{ cn: '积怨', tw: '積怨（校）', status: 'verified' }]),
  })
  const out = t.text('text', '科斯蒂利亚获得⟦buf:98321014|积怨⟧，伤害提升⟦em:10%⟧', 9)
  assert.equal(out, '科斯蒂莉亞獲得⟦buf:98321014|積怨（校）⟧，傷害提升⟦em:10%⟧')
})

test('text：有整段條目時直接用條目', () => {
  const t = new Translator({ text: doc([{ cn: '原文', tw: '人工譯文', status: 'verified' }]) })
  assert.equal(t.text('text', '原文', 1), '人工譯文')
  assert.equal(t.pendingList().length, 0)
})

test('usedList：已校、站上既有、機轉都記下（後台要能改已確認過的）；pin 覆蓋成官方譯名', () => {
  const t = new Translator(
    { unit: doc([{ cn: '科斯蒂利亚', tw: '科斯蒂莉亞', status: 'verified', source: 'manual' }]) },
    { mech: new Set(['戴亞斯']) },
  )
  t.name('unit', '科斯蒂利亚', 9)
  t.name('mech', '戴亚斯', 9)
  t.text('text', '击败戴亚斯', 9)
  t.name('season', '归途', 19)
  t.pin('season', '归途', '歸途（時間線）', 'timeline', 19)
  const used = Object.fromEntries(t.usedList().map((u) => [`${u.kind}:${u.cn}`, `${u.tw}|${u.status}|${u.source}`]))
  assert.deepEqual(used, {
    'unit:科斯蒂利亚': '科斯蒂莉亞|verified|manual',
    'mech:戴亚斯': '戴亞斯|verified|site',
    'text:击败戴亚斯': '擊敗戴亞斯|pending|machine',
    'season:归途': '歸途（時間線）|verified|timeline',
  })
})
