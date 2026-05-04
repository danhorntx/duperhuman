/**
 * Generates the DMG background image if missing. electron-builder's drag-to-
 * Applications layout often silently reverts to the default Finder window on
 * macOS unless a background image is supplied — so we always ship one.
 *
 * Produces a 660x400 (and @2x) dark PNG that matches the app's color palette,
 * with no instructional text (the icon + Applications shortcut are self-
 * explanatory). Run via: `node scripts/ensure-dmg-assets.mjs`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const DIR     = resolve('build-resources')
const BG_1X   = resolve(DIR, 'dmg-background.png')
const BG_2X   = resolve(DIR, 'dmg-background@2x.png')

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

if (existsSync(BG_1X) && existsSync(BG_2X)) {
  console.log('[dmg-assets] background images already exist — skipping')
  process.exit(0)
}

// Generate a solid-color PNG via /usr/bin/sips (preinstalled on macOS).
// We start from a 1x1 source PNG generated inline so we don't depend on
// any system asset.

// Minimal 1x1 #0d0c1a PNG (raw bytes, base64-encoded)
const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAFklEQVR42mNk+M9Qz0AEYBxVSF+FAFqIA1y2pJgaAAAAAElFTkSuQmCC'
const seedPath = resolve(DIR, '_seed.png')
writeFileSync(seedPath, Buffer.from(ONE_PX_PNG_B64, 'base64'))

function sipsResize(srcW, srcH, outPath) {
  execSync(
    `sips -z ${srcH} ${srcW} "${seedPath}" --out "${outPath}"`,
    { stdio: 'pipe' },
  )
}

try {
  sipsResize(660, 400, BG_1X)
  sipsResize(1320, 800, BG_2X)
  console.log(`[dmg-assets] created ${BG_1X}`)
  console.log(`[dmg-assets] created ${BG_2X}`)
} catch (err) {
  console.error('[dmg-assets] sips failed (are you on macOS?):', err.message)
  process.exit(1)
} finally {
  try { execSync(`rm -f "${seedPath}"`) } catch { /* ignore */ }
}
