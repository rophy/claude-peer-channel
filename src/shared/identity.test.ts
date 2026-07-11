import { describe, it, expect } from 'vitest'
import { userInfo } from 'node:os'
import { getCurrentUser } from './identity.js'

describe('getCurrentUser', () => {
  it('returns the current OS username and uid', () => {
    const info = userInfo()
    const user = getCurrentUser()
    expect(user.username).toBe(info.username)
    expect(user.uid).toBe(info.uid)
  })
})
