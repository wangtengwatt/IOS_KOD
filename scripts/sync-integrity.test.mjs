import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  gitAuthenticationEnvironment,
  managedDependencyInstallPolicy,
  runCommand,
  safeReplaceWebRoot,
  scrubNonGitEnvironment,
  recoverWebRootBackup,
  validateNativePluginOwnership,
  validateManifest,
  verifyBundleTree,
} from './sync-upstream.mjs'

const commit = '4'.repeat(40)
const lock = {
  schemaVersion: 1,
  repository: 'https://gitlab.kaiweb.org/KAI/oD/KoD/kod.git',
  commit,
  releaseTrain: 'kod-2026.08.18.1',
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const manifestFor = (files) => ({
  schemaVersion: 1,
  product: 'KOD',
  platform: 'ios',
  sourceCommit: commit,
  sourceVersion: '0.0.1',
  files,
  nativePlugins: [],
  rendererSha256: sha256(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')),
})
const file = (path, contents) => ({ path, bytes: Buffer.byteLength(contents), sha256: sha256(contents) })

test('manifest rejects traversal, absolute, backslash, duplicate, and unsorted paths', () => {
  for (const badPath of ['../x', 'a/../x', '/x', 'C:/x', 'a\\x', './x', 'a//x']) {
    const files = [file(badPath, 'x')]
    assert.throws(() => validateManifest(lock, manifestFor(files)), /path/i)
  }
  const duplicate = [file('a.js', 'a'), file('a.js', 'a')]
  assert.throws(() => validateManifest(lock, manifestFor(duplicate)), /sorted|duplicate/i)
  const unsorted = [file('z.js', 'z'), file('a.js', 'a')]
  assert.throws(() => validateManifest(lock, manifestFor(unsorted)), /sorted/i)
})

test('bundle verification rejects tampered, extra, and missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kod-ios-integrity-'))
  await writeFile(join(root, 'a.js'), 'a')
  const manifest = manifestFor([file('a.js', 'a')])
  await writeFile(join(root, 'kod-build-manifest.json'), JSON.stringify(manifest))
  await verifyBundleTree(root, manifest)

  await writeFile(join(root, 'a.js'), 'tampered')
  await assert.rejects(verifyBundleTree(root, manifest), /byte|sha-?256/i)
  await writeFile(join(root, 'a.js'), 'a')
  await writeFile(join(root, 'extra.js'), 'extra')
  await assert.rejects(verifyBundleTree(root, manifest), /extra|unexpected/i)
  await rm(join(root, 'extra.js'))
  await rm(join(root, 'a.js'))
  await assert.rejects(verifyBundleTree(root, manifest), /missing/i)
})

test('bundle verification rejects symbolic links or Windows junctions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kod-ios-symlink-'))
  const external = await mkdtemp(join(tmpdir(), 'kod-ios-external-'))
  await writeFile(join(external, 'a.js'), 'a')
  try {
    await symlink(external, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`)
    return
  }
  await assert.rejects(verifyBundleTree(root, manifestFor([])), /symbolic link|junction/i)
})

test('replacement rejects a symlinked or junction www target', async (t) => {
  const wrapper = await mkdtemp(join(tmpdir(), 'kod-ios-wrapper-link-'))
  const external = await mkdtemp(join(tmpdir(), 'kod-ios-www-external-'))
  const source = await mkdtemp(join(tmpdir(), 'kod-ios-source-link-'))
  const manifest = manifestFor([file('a.js', 'a')])
  await writeFile(join(source, 'a.js'), 'a')
  await writeFile(join(source, 'kod-build-manifest.json'), JSON.stringify(manifest))
  try {
    await symlink(external, join(wrapper, 'www'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`)
    return
  }
  await assert.rejects(safeReplaceWebRoot(source, wrapper, manifest), /symbolic link|junction/i)
})

test('replacement verifies the temporary copy before safely swapping www', async () => {
  const wrapper = await mkdtemp(join(tmpdir(), 'kod-ios-wrapper-'))
  const source = await mkdtemp(join(tmpdir(), 'kod-ios-source-'))
  await mkdir(join(wrapper, 'www'))
  await writeFile(join(wrapper, 'www', 'stale.js'), 'stale')
  await writeFile(join(source, 'a.js'), 'a')
  const manifest = manifestFor([file('a.js', 'a')])
  await writeFile(join(source, 'kod-build-manifest.json'), JSON.stringify(manifest))

  await safeReplaceWebRoot(source, wrapper, manifest)

  assert.equal(await readFile(join(wrapper, 'www', 'a.js'), 'utf8'), 'a')
  await assert.rejects(readFile(join(wrapper, 'www', 'stale.js')), /ENOENT/)
})

test('protected upstream Git auth stays in child env and is redacted from diagnostics', () => {
  const token = 'kod-read-token-super-secret'
  const { env, secrets } = gitAuthenticationEnvironment(
    {
      PATH: 'safe',
      KOD_UPSTREAM_READ_TOKEN: token,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.attacker.invalid.extraheader',
      GIT_CONFIG_VALUE_0: 'unsafe',
    },
    token,
  )
  assert.equal(env.GIT_CONFIG_COUNT, '1')
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://gitlab.kaiweb.org/.extraheader')
  assert.ok(env.GIT_CONFIG_VALUE_0.includes(token))
  assert.equal(env.KOD_UPSTREAM_READ_TOKEN, undefined)
  assert.deepEqual(secrets, [token])
  assert.throws(
    () => runCommand(process.execPath, ['-e', `console.error('${token}'); process.exit(2)`], process.cwd(), env, secrets),
    (error) => !error.message.includes(token) && error.message.includes('[REDACTED]'),
  )
})

test('install, build, and Capacitor child fixtures never inherit upstream auth variables', () => {
  for (const child of ['install', 'build', 'cap']) {
    const clean = scrubNonGitEnvironment({
      PATH: `safe-${child}`,
      KOD_UPSTREAM_READ_TOKEN: 'secret',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.x.extraheader',
      GIT_CONFIG_VALUE_0: 'PRIVATE-TOKEN: secret',
    })
    assert.deepEqual(clean, { PATH: `safe-${child}` })
  }
})

test('replacement recovers a sole crash backup when www is missing', async () => {
  const wrapper = await mkdtemp(join(tmpdir(), 'kod-ios-recover-'))
  const backup = join(wrapper, '.www-backup-crash')
  await mkdir(backup)
  await writeFile(join(backup, 'last-good.js'), 'ok')
  await recoverWebRootBackup(wrapper)
  assert.equal(await readFile(join(wrapper, 'www', 'last-good.js'), 'utf8'), 'ok')
  await assert.rejects(readFile(join(backup, 'last-good.js')), /ENOENT/)
})

test('managed upstream always performs a frozen install while configured local upstream may reuse dependencies', () => {
  assert.equal(managedDependencyInstallPolicy(true), 'frozen-install')
  assert.equal(managedDependencyInstallPolicy(false), 'reuse-configured-upstream')
})

test('canonical manifest drives wrapper dependency, Pod, and generated registration ownership', () => {
  const manifest = { ...manifestFor([]), nativePlugins: ['@capacitor/app', 'capacitor-stream-http'] }
  const packageJson = { dependencies: { '@capacitor/app': '7.1.2', 'capacitor-stream-http': '0.1.0' } }
  const podfile = "node_modules/@capacitor/app\nnode_modules/capacitor-stream-http"
  const nativeConfig = { packageClassList: ['AppPlugin', 'StreamHttpPlugin'] }

  assert.doesNotThrow(() => validateNativePluginOwnership(manifest, packageJson, podfile, nativeConfig))
  assert.throws(
    () => validateNativePluginOwnership(manifest, { dependencies: {} }, podfile, nativeConfig),
    /missing canonical native plugin dependency/i,
  )
  assert.throws(
    () => validateNativePluginOwnership(manifest, packageJson, '', nativeConfig),
    /Podfile/i,
  )
  assert.throws(
    () => validateNativePluginOwnership(manifest, packageJson, podfile, { packageClassList: ['AppPlugin'] }),
    /registration/i,
  )
})
