import assert from 'node:assert/strict'
import test from 'node:test'

import { validateLock, validateManifest } from './sync-upstream.mjs'

const commit = '4444444444444444444444444444444444444444'
const validLock = {
  schemaVersion: 1,
  repository: 'https://gitlab.kaiweb.org/KAI/oD/KoD/kod.git',
  commit,
  releaseTrain: 'kod-2026.08.18.1',
}
const validManifest = {
  schemaVersion: 1,
  product: 'KOD',
  platform: 'ios',
  sourceCommit: commit,
  sourceVersion: '0.0.1',
  rendererSha256: 'a'.repeat(64),
  files: [],
}

test('lock and iOS manifest must match exactly', () => {
  const lock = validateLock(validLock)
  assert.doesNotThrow(() => validateManifest(lock, validManifest))
})

test('Android artifacts are rejected by the iOS wrapper', () => {
  assert.throws(
    () => validateManifest(validLock, { ...validManifest, platform: 'android' }),
    /platform must be ios/,
  )
})

test('a manifest from a different canonical commit is rejected', () => {
  assert.throws(
    () => validateManifest(validLock, { ...validManifest, sourceCommit: '5'.repeat(40) }),
    /sourceCommit does not match lock/,
  )
})

test('lock rejects malformed or mutable upstream identities', () => {
  const invalidCases = [
    [{ ...validLock, schemaVersion: 2 }, /schemaVersion must be 1/],
    [{ ...validLock, repository: 'http://gitlab.kaiweb.org/KAI/oD/KoD/kod.git' }, /HTTPS URL/],
    [{ ...validLock, repository: 'https:///' }, /HTTPS URL/],
    [{ ...validLock, commit: 'A'.repeat(40) }, /lowercase 40-character/],
    [{ ...validLock, commit: '4'.repeat(39) }, /lowercase 40-character/],
    [{ ...validLock, releaseTrain: 'main' }, /kod-YYYY.MM.DD.N/],
  ]

  for (const [value, expected] of invalidCases) assert.throws(() => validateLock(value), expected)
})

test('manifest rejects invalid product, schema, and renderer digest', () => {
  const invalidCases = [
    [{ ...validManifest, schemaVersion: 2 }, /schemaVersion must be 1/],
    [{ ...validManifest, product: 'Other' }, /product must be KOD/],
    [{ ...validManifest, rendererSha256: 'not-a-digest' }, /rendererSha256/],
    [{ ...validManifest, files: null }, /files must be an array/],
  ]

  for (const [value, expected] of invalidCases) {
    assert.throws(() => validateManifest(validLock, value), expected)
  }
})
