import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const requiredNativeDependencies = {
  '@capacitor-community/sqlite': '7.0.3',
  '@capacitor/app': '7.1.2',
  '@capacitor/app-launcher': '7.0.4',
  '@capacitor/browser': '7.0.5',
  '@capacitor/device': '7.0.5',
  '@capacitor/filesystem': '7.1.6',
  '@capacitor/keyboard': '7.0.6',
  '@capacitor/share': '7.0.4',
  '@capacitor/splash-screen': '7.0.5',
  '@capacitor/toast': '7.0.4',
  'capacitor-plugin-safe-area': '4.0.3',
  'capacitor-stream-http': '0.1.0',
}

test('wrapper owns every iOS-capable renderer-required native plugin', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const podfile = await readFile(new URL('../ios/App/Podfile', import.meta.url), 'utf8')

  assert.equal(packageJson.dependencies?.['@capacitor/core'], '7.4.5')
  assert.equal(packageJson.devDependencies?.['@capacitor/cli'], '7.4.5')
  assert.equal(packageJson.devDependencies?.['@capacitor/ios'], '7.4.5')

  for (const [dependency, version] of Object.entries(requiredNativeDependencies)) {
    assert.equal(packageJson.dependencies?.[dependency], version, `${dependency} must match canonical KOD`)
    assert.match(podfile, new RegExp(`node_modules/${dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  }
})

test('pnpm lock has exactly the wrapper root importer', async () => {
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  const importerBlock = lock.match(/\nimporters:\n([\s\S]*?)\npackages:/)?.[1] || ''
  const importers = [...importerBlock.matchAll(/^  ([^\s].*):$/gm)].map((match) => match[1])
  assert.deepEqual(importers, ['.'])
})
