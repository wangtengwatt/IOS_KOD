import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const wrapperRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const fixtureFiles = [
  'LICENSE',
  'kod-upstream.lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'ios/App/Podfile',
  'ios/App/App/BridgeViewController.swift',
  'ios/App/App/PrivacyInfo.xcprivacy',
  'ios/App/App.xcodeproj/project.pbxproj',
  'scripts/sync-upstream.mjs',
  'scripts/verify-thin-wrapper.mjs',
]

async function makeFreshFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'kod-ios-thin-verifier-'))
  for (const relativePath of fixtureFiles) {
    const target = resolve(fixtureRoot, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await cp(resolve(wrapperRoot, relativePath), target)
  }
  return fixtureRoot
}

function runFixtureVerifier(fixtureRoot) {
  return spawnSync(process.execPath, [resolve(fixtureRoot, 'scripts', 'verify-thin-wrapper.mjs')], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  })
}

test('thin-wrapper verifier passes from a fresh portable tree without sibling source or installed dependencies', async () => {
  const fixtureRoot = await makeFreshFixture()
  try {
    const result = runFixtureVerifier(fixtureRoot)

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    assert.match(result.stdout, /thin-wrapper verification passed/i)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('thin-wrapper verifier rejects a tracked Pod path outside the wrapper', async () => {
  const fixtureRoot = await makeFreshFixture()
  try {
    const podfilePath = resolve(fixtureRoot, 'ios', 'App', 'Podfile')
    const podfile = (await readFile(podfilePath, 'utf8')).replaceAll(
      '../../node_modules',
      '../../../canonical/node_modules',
    )
    await writeFile(podfilePath, podfile)

    const result = runFixtureVerifier(fixtureRoot)
    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    assert.match(result.stderr, /Podfile[\s\S]*(?:outside|wrapper|node_modules)/i)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
