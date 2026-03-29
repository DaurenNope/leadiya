import { describe, expect, test } from 'vitest'
import { resolveCategory, resolveLeadCategory } from '../lib/category'

describe('resolveCategory', () => {
  test('uses first valid candidate', () => {
    expect(resolveCategory('  кафе  ', 'Новостройки')).toBe('Кафе')
  })

  test('skips URL-like garbage and falls back', () => {
    expect(resolveCategory('https://example.com/abc?x=1', 'новостройка')).toBe('Новостройки')
  })

  test('returns fallback when all empty', () => {
    expect(resolveCategory('', undefined, null)).toBe('Без категории')
  })

  test('name sanity overrides wrong context for medical lead', () => {
    expect(resolveLeadCategory('Global Dent', 'Кафе', '')).toBe('Медицина')
  })
})

