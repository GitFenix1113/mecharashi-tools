// PLAN-042-H：角色判斷 helper
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASSIGNABLE_ROLES, ROLE_LABEL, canEditLore, isAdminRole } from './userRole.ts'

test('後台全區只放行 ADMIN／OWNER，故事館協作編輯進不去', () => {
  assert.equal(isAdminRole('OWNER'), true)
  assert.equal(isAdminRole('ADMIN'), true)
  assert.equal(isAdminRole('LORE_EDITOR'), false)
  assert.equal(isAdminRole('USER'), false)
  assert.equal(isAdminRole(null), false)
  assert.equal(isAdminRole(undefined), false)
})

test('故事館編輯台放行管理者與故事館協作編輯', () => {
  assert.equal(canEditLore('OWNER'), true)
  assert.equal(canEditLore('ADMIN'), true)
  assert.equal(canEditLore('LORE_EDITOR'), true)
  assert.equal(canEditLore('USER'), false)
  assert.equal(canEditLore(null), false)
})

test('可指派角色不含 OWNER，且每一個都有顯示名稱', () => {
  assert.equal(ASSIGNABLE_ROLES.includes('OWNER'), false)
  for (const r of ASSIGNABLE_ROLES) assert.ok(ROLE_LABEL[r])
})
