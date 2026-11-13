#!/usr/bin/env node
/* global process */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.resolve(rootDir, 'dist')
const publicDir = path.resolve(rootDir, 'public')

const TARGETS = {
  chromium: {
    name: 'Chromium (Chrome, Edge, Brave, Opera)',
    manifestFile: 'manifest.chromium.json',
    outDir: path.join(distDir, 'chromium'),
  },
  firefox: {
    name: 'Mozilla Firefox',
    manifestFile: 'manifest.firefox.json',
    outDir: path.join(distDir, 'firefox'),
  },
  safari: {
    name: 'Safari (macOS / iOS converter input)',
    manifestFile: 'manifest.safari.json',
    outDir: path.join(distDir, 'safari'),
  },
}

const EXCLUDE_FROM_TARGET_COPY = new Set([
  'chromium',
  'firefox',
  'safari',
  'manifest.json',
  'manifest.chromium.json',
  'manifest.firefox.json',
  'manifest.safari.json',
])

function runViteBuild() {
  console.log('⚡ Building shared extension bundles with Vite...')
  execSync('npm run build:vite', { cwd: rootDir, stdio: 'inherit' })
}

function verifyNoUrlOverrides(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manifest verification failed: file does not exist at ${filePath}`)
  }
  const content = fs.readFileSync(filePath, 'utf8')
  if (content.includes('chrome_url_overrides')) {
    throw new Error(`FATAL: chrome_url_overrides found in ${filePath}! Static overrides are strictly forbidden.`)
  }
}

function packageTarget(targetKey) {
  const target = TARGETS[targetKey]
  if (!target) {
    console.error(`Unknown target: "${targetKey}". Valid targets are: ${Object.keys(TARGETS).join(', ')}`)
    process.exit(1)
  }

  console.log(`\n📦 Packaging for ${target.name}...`)

  // Ensure clean target output directory
  if (fs.existsSync(target.outDir)) {
    fs.rmSync(target.outDir, { recursive: true, force: true })
  }
  fs.mkdirSync(target.outDir, { recursive: true })

  // Copy shared built artifacts excluding target folders and variant manifests
  const entries = fs.readdirSync(distDir)
  for (const entry of entries) {
    if (EXCLUDE_FROM_TARGET_COPY.has(entry)) continue
    const srcPath = path.join(distDir, entry)
    const destPath = path.join(target.outDir, entry)
    fs.cpSync(srcPath, destPath, { recursive: true })
  }

  // Copy the target-specific manifest as manifest.json
  const manifestSrc = path.join(publicDir, target.manifestFile)
  if (!fs.existsSync(manifestSrc)) {
    console.error(`Manifest source not found: ${manifestSrc}`)
    process.exit(1)
  }
  const manifestDest = path.join(target.outDir, 'manifest.json')
  fs.copyFileSync(manifestSrc, manifestDest)

  // Strict verification: ensure no chrome_url_overrides
  verifyNoUrlOverrides(manifestDest)

  console.log(`✅ [${targetKey}] Created verified distribution at ${path.relative(rootDir, target.outDir)}`)
}

function syncRootDistManifest() {
  // Overwrite dist/manifest.json with verified Chromium manifest
  // This ensures that even if a developer loads dist/ directly, it has the correct manifest
  const chromiumManifestSrc = path.join(publicDir, 'manifest.chromium.json')
  const rootManifestDest = path.join(distDir, 'manifest.json')
  if (fs.existsSync(chromiumManifestSrc)) {
    fs.copyFileSync(chromiumManifestSrc, rootManifestDest)
    verifyNoUrlOverrides(rootManifestDest)
  }

  // Clean variant manifests from root dist
  for (const filename of ['manifest.chromium.json', 'manifest.firefox.json', 'manifest.safari.json']) {
    const p = path.join(distDir, filename)
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true })
    }
  }
}

function main() {
  const requestedTarget = process.argv[2]?.toLowerCase()

  runViteBuild()

  if (!requestedTarget || requestedTarget === 'all') {
    for (const key of Object.keys(TARGETS)) {
      packageTarget(key)
    }
    syncRootDistManifest()
    console.log('\n🎉 Successfully generated all browser target packages in dist/:')
    console.log('   - dist/chromium/  (Chrome, Edge, Brave, Opera) [VERIFIED: no chrome_url_overrides]')
    console.log('   - dist/firefox/   (Mozilla Firefox)')
    console.log('   - dist/safari/    (Safari macOS / iOS conversion)')
  } else {
    packageTarget(requestedTarget)
    syncRootDistManifest()
    console.log(`\n🎉 Successfully generated target package for ${requestedTarget}. [VERIFIED: no chrome_url_overrides]`)
  }
}

main()
