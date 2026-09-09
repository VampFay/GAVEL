/**
 * Renders scripts/og-card.html → public/og.png (1200×630 @2x = 2400×1260).
 * Run: node scripts/render-og.mjs
 * Uses Playwright chromium + Geist from Google Fonts (network required).
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  })
  const url = 'file://' + path.resolve(__dirname, 'og-card.html')
  await page.goto(url, { waitUntil: 'networkidle' })
  // Ensure webfont is actually loaded before screenshot.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  const out = path.resolve(__dirname, '../public/og.png')
  await page.screenshot({ path: out, type: 'png' })
  await browser.close()
  const kb = Math.round(fs.statSync(out).size / 1024)
  console.log(`OK: ${out} (${kb} KB, 2400x1260)`)
}

main().catch(err => {
  console.error('render-og failed:', err.message)
  process.exit(1)
})
