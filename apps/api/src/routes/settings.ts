import { Hono } from 'hono'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { AppEnv } from '../types.js'

const settingsRouter = new Hono<AppEnv>()

function configPath(file: string): string {
  return join(process.cwd(), 'config', file)
}

function readYaml(file: string): Record<string, unknown> {
  return parseYaml(readFileSync(configPath(file), 'utf8')) as Record<string, unknown>
}

function writeYaml(file: string, data: Record<string, unknown>): void {
  writeFileSync(configPath(file), stringifyYaml(data, { indent: 2 }), 'utf8')
}

// GET /api/settings/automation
settingsRouter.get('/automation', (c) => {
  try {
    const doc = readYaml('business.yml')
    return c.json({ automation: doc.automation ?? {} })
  } catch (e) {
    return c.json({ error: 'Failed to read config', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// PUT /api/settings/automation
settingsRouter.put('/automation', async (c) => {
  try {
    const body = await c.req.json()
    const doc = readYaml('business.yml')
    doc.automation = { ...(doc.automation as Record<string, unknown> ?? {}), ...body }
    writeYaml('business.yml', doc)
    return c.json({ ok: true, automation: doc.automation })
  } catch (e) {
    return c.json({ error: 'Failed to save config', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// GET /api/settings/discovery
settingsRouter.get('/discovery', (c) => {
  try {
    const doc = readYaml('business.yml')
    const d = (doc.discovery ?? {}) as Record<string, unknown>
    return c.json({
      cities: Array.isArray(d.cities) ? d.cities : [],
      categories: Array.isArray(d.categories) ? d.categories : [],
    })
  } catch (e) {
    return c.json({ error: 'Failed to read config', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// PUT /api/settings/discovery
settingsRouter.put('/discovery', async (c) => {
  try {
    const body = await c.req.json() as { cities?: string[]; categories?: string[] }
    const doc = readYaml('business.yml')
    const d = (doc.discovery ?? {}) as Record<string, unknown>
    if (Array.isArray(body.cities)) d.cities = body.cities
    if (Array.isArray(body.categories)) d.categories = body.categories
    doc.discovery = d
    writeYaml('business.yml', doc)
    return c.json({ ok: true, cities: d.cities, categories: d.categories })
  } catch (e) {
    return c.json({ error: 'Failed to save config', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// GET /api/settings/company
settingsRouter.get('/company', (c) => {
  try {
    const doc = readYaml('business.yml')
    return c.json({ company: doc.company ?? {} })
  } catch (e) {
    return c.json({ error: 'Failed to read config', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// PUT /api/settings/company
settingsRouter.put('/company', async (c) => {
  try {
    const body = await c.req.json()
    const doc = readYaml('business.yml')
    doc.company = { ...(doc.company as Record<string, unknown> ?? {}), ...body }
    writeYaml('business.yml', doc)
    return c.json({ ok: true, company: doc.company })
  } catch (e) {
    return c.json({ error: 'Failed to save config', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// GET /api/settings/sequences
settingsRouter.get('/sequences', (c) => {
  try {
    const doc = readYaml('sequences.yml')
    return c.json({ sequences: doc })
  } catch (e) {
    return c.json({ error: 'Failed to read sequences', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// PUT /api/settings/sequences/:key
settingsRouter.put('/sequences/:key', async (c) => {
  try {
    const key = c.req.param('key')
    const body = await c.req.json()
    const doc = readYaml('sequences.yml')
    if (!doc[key]) {
      return c.json({ error: `Sequence '${key}' not found` }, 404)
    }
    doc[key] = { ...(doc[key] as Record<string, unknown>), ...body }
    writeYaml('sequences.yml', doc)
    return c.json({ ok: true, sequence: doc[key] })
  } catch (e) {
    return c.json({ error: 'Failed to save sequence', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})

export { settingsRouter }
