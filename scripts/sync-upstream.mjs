import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const wrapperRoot = resolve(dirname(scriptPath), '..')
const manifestName = 'kod-build-manifest.json'
const pnpm = process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm'

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

export function validateLock(value) {
  const lock = requireObject(value, 'upstream lock')
  if (lock.schemaVersion !== 1) throw new Error('upstream lock schemaVersion must be 1')

  let repository
  try {
    repository = new URL(lock.repository)
  } catch {
    throw new Error('upstream repository must be an HTTPS URL')
  }
  if (repository.protocol !== 'https:' || !repository.hostname) {
    throw new Error('upstream repository must be an HTTPS URL')
  }
  if (typeof lock.commit !== 'string' || !/^[a-f0-9]{40}$/.test(lock.commit)) {
    throw new Error('upstream commit must be a lowercase 40-character SHA-1')
  }
  if (typeof lock.releaseTrain !== 'string' || !/^kod-\d{4}\.\d{2}\.\d{2}\.\d+$/.test(lock.releaseTrain)) {
    throw new Error('releaseTrain must match kod-YYYY.MM.DD.N')
  }

  return {
    schemaVersion: 1,
    repository: repository.href,
    commit: lock.commit,
    releaseTrain: lock.releaseTrain,
  }
}

export function validateManifest(lockValue, value) {
  const lock = validateLock(lockValue)
  const manifest = requireObject(value, 'iOS build manifest')
  if (manifest.schemaVersion !== 1) throw new Error('manifest schemaVersion must be 1')
  if (manifest.product !== 'KOD') throw new Error('manifest product must be KOD')
  if (manifest.platform !== 'ios') throw new Error('manifest platform must be ios')
  if (manifest.sourceCommit !== lock.commit) throw new Error('manifest sourceCommit does not match lock commit')
  if (typeof manifest.sourceVersion !== 'string' || !manifest.sourceVersion) {
    throw new Error('manifest sourceVersion must be a non-empty string')
  }
  if (typeof manifest.rendererSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.rendererSha256)) {
    throw new Error('manifest rendererSha256 must be a lowercase SHA-256 digest')
  }
  if (!Array.isArray(manifest.files)) throw new Error('manifest files must be an array')
  if (!Array.isArray(manifest.nativePlugins) || manifest.nativePlugins.some((name) => typeof name !== 'string')) {
    throw new Error('manifest nativePlugins must be an array of package names')
  }
  for (let index = 0; index < manifest.nativePlugins.length; index += 1) {
    const name = manifest.nativePlugins[index]
    if (!/^(?:@[-a-z0-9._]+\/)?[-a-z0-9._]+$/.test(name)) {
      throw new Error('manifest nativePlugins contains an invalid package name')
    }
    if (index > 0 && name <= manifest.nativePlugins[index - 1]) {
      throw new Error('manifest nativePlugins must be unique and sorted')
    }
  }
  let previousPath = null
  for (const file of manifest.files) {
    requireObject(file, 'manifest file')
    if (
      typeof file.path !== 'string' ||
      !file.path ||
      file.path.includes('\\') ||
      file.path.startsWith('/') ||
      isAbsolute(file.path) ||
      /^[a-zA-Z]:/.test(file.path) ||
      file.path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error('manifest file path must be a non-empty relative POSIX path')
    }
    if (previousPath !== null && file.path <= previousPath) {
      throw new Error('manifest file paths must be unique and sorted in ordinal order')
    }
    previousPath = file.path
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('manifest file bytes must be non-negative')
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('manifest file sha256 must be a lowercase SHA-256 digest')
    }
  }
  const rows = manifest.files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')
  if (sha256(Buffer.from(rows, 'utf8')) !== manifest.rendererSha256) {
    throw new Error('manifest rendererSha256 does not match its file rows')
  }
  return manifest
}

export function validateNativePluginOwnership(manifestValue, packageValue, podfile, nativeConfigValue) {
  const manifest = requireObject(manifestValue, 'iOS build manifest')
  const packageJson = requireObject(packageValue, 'wrapper package.json')
  const dependencies = requireObject(packageJson.dependencies, 'wrapper dependencies')
  const nativeConfig = requireObject(nativeConfigValue, 'generated native config')
  if (!Array.isArray(nativeConfig.packageClassList)) {
    throw new Error('generated native registration list is missing')
  }
  for (const plugin of manifest.nativePlugins) {
    if (typeof dependencies[plugin] !== 'string' || !dependencies[plugin]) {
      throw new Error(`wrapper is missing canonical native plugin dependency: ${plugin}`)
    }
    if (!podfile.includes(`node_modules/${plugin}`)) {
      throw new Error(`Podfile is missing canonical native plugin: ${plugin}`)
    }
  }
  if (nativeConfig.packageClassList.length !== manifest.nativePlugins.length) {
    throw new Error('generated native plugin registration count does not match canonical manifest')
  }
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function redact(value, secrets) {
  return secrets.reduce((result, secret) => (secret ? result.replaceAll(secret, '[REDACTED]') : result), value)
}

export function gitAuthenticationEnvironment(baseEnvironment, token) {
  const env = scrubNonGitEnvironment(baseEnvironment)
  if (!token) return { env, secrets: [] }
  if (typeof token !== 'string' || /[\r\n]/.test(token)) throw new Error('KOD upstream read token is invalid')
  const count = Number.parseInt(env.GIT_CONFIG_COUNT || '0', 10)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('GIT_CONFIG_COUNT is invalid')
  env.GIT_CONFIG_COUNT = String(count + 1)
  env[`GIT_CONFIG_KEY_${count}`] = 'http.https://gitlab.kaiweb.org/.extraheader'
  env[`GIT_CONFIG_VALUE_${count}`] = `PRIVATE-TOKEN: ${token}`
  return { env, secrets: [token] }
}

export function scrubNonGitEnvironment(baseEnvironment) {
  return Object.fromEntries(
    Object.entries(baseEnvironment).filter(
      ([key]) => key !== 'KOD_UPSTREAM_READ_TOKEN' && !key.startsWith('GIT_CONFIG_'),
    ),
  )
}

export function managedDependencyInstallPolicy(managed) {
  return managed ? 'frozen-install' : 'reuse-configured-upstream'
}

export function runCommand(command, arguments_, cwd, env = process.env, secrets = []) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  })
  if (result.error || result.status !== 0) {
    const exitCode = result.status ?? 'spawn-error'
    const stdout = redact(result.stdout || '', secrets)
    const stderr = redact(result.stderr || result.error?.message || '', secrets)
    throw new Error(
      redact(
        `command failed: ${command} ${arguments_.join(' ')}\nexit code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        secrets,
      ),
    )
  }
  return redact(result.stdout.trim(), secrets)
}

function runPnpm(arguments_, cwd, env = process.env) {
  const childEnvironment = scrubNonGitEnvironment(env)
  if (process.platform === 'win32') {
    const corepack = resolve(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
    if (existsSync(corepack)) return runCommand(process.execPath, [corepack, 'pnpm', ...arguments_], cwd, childEnvironment)
  }
  return runCommand(pnpm, arguments_, cwd, childEnvironment)
}

function upstreamBuildEnvironment(upstreamRoot) {
  const baseEnvironment = scrubNonGitEnvironment(process.env)
  if (process.platform !== 'win32') return baseEnvironment
  const preload = resolve(upstreamRoot, 'scripts', 'platform-release', 'test-support', 'windows-node-userinfo-shim.cjs')
  if (!existsSync(preload)) return baseEnvironment
  return {
    ...baseEnvironment,
    npm_config_node_options: `--max-old-space-size=4096 --require="${preload.replaceAll('\\', '/')}"`,
  }
}

function wrapperCommandEnvironment() {
  const baseEnvironment = scrubNonGitEnvironment(process.env)
  if (process.platform !== 'win32') return baseEnvironment
  const preload = resolve(wrapperRoot, 'scripts', 'windows-node-userinfo-shim.cjs')
  if (!existsSync(preload)) return baseEnvironment
  return {
    ...baseEnvironment,
    npm_config_node_options: `--require="${preload.replaceAll('\\', '/')}"`,
  }
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false
    throw error
  }
}

async function prepareManagedUpstream(lock) {
  const cacheRoot = resolve(wrapperRoot, '.kod-upstream')
  const upstreamRoot = resolve(cacheRoot, 'kod')
  const authentication = gitAuthenticationEnvironment(process.env, process.env.KOD_UPSTREAM_READ_TOKEN)
  if (!(await exists(upstreamRoot))) {
    await mkdir(cacheRoot, { recursive: true })
    runCommand(
      'git',
      ['clone', '--no-checkout', lock.repository, upstreamRoot],
      wrapperRoot,
      authentication.env,
      authentication.secrets,
    )
  } else {
    const remote = runCommand('git', ['remote', 'get-url', 'origin'], upstreamRoot)
    if (remote !== lock.repository) throw new Error('cached upstream origin does not match lock repository')
  }

  runCommand(
    'git',
    ['fetch', '--prune', 'origin', lock.commit],
    upstreamRoot,
    authentication.env,
    authentication.secrets,
  )
  runCommand('git', ['checkout', '--detach', lock.commit], upstreamRoot)
  return upstreamRoot
}

async function assertExactHead(upstreamRoot, commit) {
  const requestedRoot = await realpath(resolve(upstreamRoot))
  const gitRoot = await realpath(resolve(runCommand('git', ['rev-parse', '--show-toplevel'], requestedRoot)))
  if (gitRoot !== requestedRoot) throw new Error('KOD upstream directory must be its Git top level')
  const head = runCommand('git', ['rev-parse', 'HEAD'], requestedRoot)
  if (head !== commit) throw new Error(`upstream HEAD does not match lock commit: expected ${commit}, received ${head}`)
  return requestedRoot
}

async function enumerateBundleFiles(root) {
  const resolvedRoot = resolve(root)
  const files = []

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name)
      const metadata = await lstat(absolutePath)
      if (metadata.isSymbolicLink()) throw new Error(`bundle contains a symbolic link or junction: ${absolutePath}`)
      if (metadata.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!metadata.isFile()) throw new Error(`bundle contains a non-regular file: ${absolutePath}`)
      const path = relative(resolvedRoot, absolutePath).replaceAll('\\', '/')
      if (path === manifestName) continue
      const contents = await readFile(absolutePath)
      files.push({ path, bytes: contents.byteLength, sha256: sha256(contents) })
    }
  }

  await visit(resolvedRoot)
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return files
}

export async function verifyBundleTree(bundleRoot, manifestValue) {
  const manifest = requireObject(manifestValue, 'iOS build manifest')
  const actualFiles = await enumerateBundleFiles(bundleRoot)
  for (let index = 0; index < Math.max(manifest.files.length, actualFiles.length); index += 1) {
    const expected = manifest.files[index]
    const actual = actualFiles[index]
    if (!expected) throw new Error(`bundle has unexpected extra file: ${actual.path}`)
    if (!actual) throw new Error(`bundle is missing file: ${expected.path}`)
    if (expected.path !== actual.path) {
      if (!actualFiles.some((file) => file.path === expected.path)) throw new Error(`bundle is missing file: ${expected.path}`)
      throw new Error(`bundle has unexpected extra file: ${actual.path}`)
    }
    if (expected.bytes !== actual.bytes) throw new Error(`bundle byte count differs for ${expected.path}`)
    if (expected.sha256 !== actual.sha256) throw new Error(`bundle SHA-256 differs for ${expected.path}`)
  }
  const rows = actualFiles.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')
  if (sha256(Buffer.from(rows, 'utf8')) !== manifest.rendererSha256) {
    throw new Error('bundle aggregate rendererSha256 differs from manifest')
  }
}

async function assertSafeWebRoot(wrapperDirectory, target) {
  const requestedRoot = resolve(wrapperDirectory)
  if (resolve(target) !== resolve(requestedRoot, 'www')) throw new Error('www target parent must equal wrapper root')
  const rootMetadata = await lstat(requestedRoot)
  if (rootMetadata.isSymbolicLink()) throw new Error('wrapper root must not be a symbolic link or junction')
  const canonicalWrapperRoot = await realpath(requestedRoot)
  if (await exists(target)) {
    const metadata = await lstat(target)
    if (metadata.isSymbolicLink()) throw new Error('refusing to replace a symbolic-link or junction www target')
    const canonicalTarget = await realpath(target)
    if (dirname(canonicalTarget) !== canonicalWrapperRoot) throw new Error('www target resolves outside wrapper root')
  }
  return canonicalWrapperRoot
}

export async function recoverWebRootBackup(wrapperDirectory = wrapperRoot) {
  const canonicalWrapperRoot = await realpath(resolve(wrapperDirectory))
  const target = resolve(canonicalWrapperRoot, 'www')
  if (await exists(target)) return false
  const backups = (await readdir(canonicalWrapperRoot))
    .filter((entry) => entry.startsWith('.www-backup-'))
    .sort()
  if (backups.length === 0) return false
  if (backups.length !== 1) throw new Error('multiple www crash backups require manual recovery')
  const backup = resolve(canonicalWrapperRoot, backups[0])
  const metadata = await lstat(backup)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('www crash backup is unsafe')
  await rename(backup, target)
  return true
}

export async function safeReplaceWebRoot(source, wrapperDirectory = wrapperRoot, manifest) {
  await verifyBundleTree(source, manifest)
  await recoverWebRootBackup(wrapperDirectory)
  const canonicalWrapperRoot = await assertSafeWebRoot(wrapperDirectory, resolve(wrapperDirectory, 'www'))
  const target = resolve(canonicalWrapperRoot, 'www')
  const temporary = await mkdtemp(resolve(canonicalWrapperRoot, '.www-sync-'))
  const backup = resolve(canonicalWrapperRoot, `.www-backup-${process.pid}-${Date.now()}`)
  let movedExisting = false
  try {
    await cp(source, temporary, { recursive: true })
    await verifyBundleTree(temporary, manifest)
    if (await exists(target)) {
      await rename(target, backup)
      movedExisting = true
    }
    await rename(temporary, target)
    if (movedExisting) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (movedExisting && !(await exists(target)) && (await exists(backup))) await rename(backup, target)
    throw error
  } finally {
    if (await exists(temporary)) await rm(temporary, { recursive: true, force: true })
  }
}

async function main() {
  const lock = validateLock(JSON.parse(await readFile(resolve(wrapperRoot, 'kod-upstream.lock.json'), 'utf8')))
  const configuredUpstream = process.env.KOD_UPSTREAM_DIR
  const managed = !configuredUpstream
  const upstreamRoot = await assertExactHead(
    managed ? await prepareManagedUpstream(lock) : configuredUpstream,
    lock.commit,
  )

  if (managedDependencyInstallPolicy(managed) === 'frozen-install') {
    runPnpm(['install', '--frozen-lockfile'], upstreamRoot, upstreamBuildEnvironment(upstreamRoot))
  }
  runPnpm(['mobile:bundle:ios'], upstreamRoot, upstreamBuildEnvironment(upstreamRoot))

  const bundleRoot = resolve(upstreamRoot, 'release', 'mobile', 'ios', 'www')
  const manifest = validateManifest(lock, JSON.parse(await readFile(resolve(bundleRoot, manifestName), 'utf8')))
  await verifyBundleTree(bundleRoot, manifest)
  await safeReplaceWebRoot(bundleRoot, wrapperRoot, manifest)
  runPnpm(['exec', 'cap', 'sync', 'ios'], wrapperRoot, wrapperCommandEnvironment())
  validateNativePluginOwnership(
    manifest,
    JSON.parse(await readFile(resolve(wrapperRoot, 'package.json'), 'utf8')),
    await readFile(resolve(wrapperRoot, 'ios', 'App', 'Podfile'), 'utf8'),
    JSON.parse(await readFile(resolve(wrapperRoot, 'ios', 'App', 'App', 'capacitor.config.json'), 'utf8')),
  )
  console.log(`Synchronized iOS wrapper from KOD commit ${lock.commit}`)
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
