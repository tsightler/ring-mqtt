#!/usr/bin/env node
// One-off diagnostic: print the codec related parts of each camera's device
// data, so the HEVC property can be identified. Read only; prints no tokens.
import { RingRestClient } from '@tsightler/ring-client-api/lib/rest-client.js'
import { readFileSync } from 'fs'

const state = JSON.parse(readFileSync(new URL('../ring-state.json', import.meta.url)))
const refreshToken = state.ring_token || state.refreshToken || state?.ring?.token

if (!refreshToken) {
    console.error('No refresh token found in ring-state.json (looked for ring_token/refreshToken)')
    console.error('Keys present:', Object.keys(state).join(', '))
    process.exit(1)
}

const client = new RingRestClient({ refreshToken })
const { doorbots = [], authorized_doorbots = [], stickup_cams = [], other = [] } =
    await client.request({ url: 'https://api.ring.com/clients_api/ring_devices' })

const cameras = [...doorbots, ...authorized_doorbots, ...stickup_cams, ...other]
console.log(`Found ${cameras.length} camera(s)\n`)

const interesting = /codec|hevc|h26[45]|encod|video|stream|resolution|profile/i

for (const cam of cameras) {
    console.log('='.repeat(70))
    console.log(`${cam.description}  (kind=${cam.kind}, id=${cam.id})`)

    const hits = []
    const walk = (obj, path) => {
        if (!obj || typeof obj !== 'object') return
        for (const [k, v] of Object.entries(obj)) {
            const p = path ? `${path}.${k}` : k
            if (v && typeof v === 'object') {
                walk(v, p)
            } else if (interesting.test(k)) {
                hits.push(`  ${p} = ${JSON.stringify(v)}`)
            }
        }
    }
    walk(cam.settings, 'settings')
    walk(cam.features, 'features')
    if (cam.metadata) walk(cam.metadata, 'metadata')

    console.log(hits.length ? hits.join('\n') : '  (no codec related keys found)')
}
