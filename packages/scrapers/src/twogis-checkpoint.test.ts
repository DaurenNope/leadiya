import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  defaultCheckpointDirectory,
  checkpointFilePath,
} from './twogis-checkpoint.js'

const TEST_DIR = join(process.cwd(), '.test-checkpoints')

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('checkpointFilePath', () => {
  it('returns a deterministic path for a city+category+strategy+url', () => {
    const path = checkpointFilePath(TEST_DIR, 'Алматы', 'Кафе', 'hybrid', 'https://2gis.kz/almaty/search/Кафе')
    expect(path).toContain(TEST_DIR)
    expect(path).toContain('.json')
  })

  it('returns same path for same inputs', () => {
    const a = checkpointFilePath(TEST_DIR, 'Алматы', 'Кафе', 'hybrid', 'https://2gis.kz/almaty/search/Кафе')
    const b = checkpointFilePath(TEST_DIR, 'Алматы', 'Кафе', 'hybrid', 'https://2gis.kz/almaty/search/Кафе')
    expect(a).toBe(b)
  })

  it('returns different path for different category', () => {
    const a = checkpointFilePath(TEST_DIR, 'Алматы', 'Кафе', 'hybrid', 'https://2gis.kz/almaty/search/Кафе')
    const b = checkpointFilePath(TEST_DIR, 'Алматы', 'Рестораны', 'hybrid', 'https://2gis.kz/almaty/search/Рестораны')
    expect(a).not.toBe(b)
  })
})

describe('defaultCheckpointDirectory', () => {
  it('returns a non-empty string', () => {
    expect(defaultCheckpointDirectory()).toBeTruthy()
  })
})
