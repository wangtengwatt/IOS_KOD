import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { validateLock, validatePodfilePortability } from './sync-upstream.mjs'

const rootArgumentIndex = process.argv.indexOf('--root')
const root =
  rootArgumentIndex === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootArgumentIndex + 1] || '')
const failures = []

for (const forbidden of [
  'src',
  'test',
  '.erb',
  'android',
  'electron.vite.config.ts',
  'vite.config.web.mts',
  'electron-builder.yml',
]) {
  if (existsSync(resolve(root, forbidden))) failures.push(`forbidden duplicate path exists: ${forbidden}`)
}

for (const required of [
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/PrivacyInfo.xcprivacy',
  'LICENSE',
  'kod-upstream.lock.json',
]) {
  if (!existsSync(resolve(root, required))) failures.push(`missing required wrapper path: ${required}`)
}

try {
  validateLock(JSON.parse(readFileSync(resolve(root, 'kod-upstream.lock.json'), 'utf8')))
} catch (error) {
  failures.push(`invalid kod-upstream.lock.json: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  const lockText = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')
  const importerBlock = lockText.match(/\nimporters:\n([\s\S]*?)\npackages:/)?.[1] || ''
  const importers = [...importerBlock.matchAll(/^  ([^\s].*):$/gm)].map((match) => match[1])
  if (importers.length !== 1 || importers[0] !== '.') failures.push('pnpm-lock.yaml must contain only importer .')
} catch (error) {
  failures.push(`unable to validate pnpm-lock.yaml: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  const podfilePath = resolve(root, 'ios', 'App', 'Podfile')
  validatePodfilePortability(readFileSync(podfilePath, 'utf8'), { wrapperRoot: root, podfilePath })
} catch (error) {
  failures.push(`invalid tracked Podfile: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length) {
  console.error(`Thin-wrapper verification failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('KOD iOS thin-wrapper verification passed')
