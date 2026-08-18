// Some managed Windows runners return UV_ENOMEM from os.userInfo() even when
// Node itself has enough memory. tsx only calls it to derive a temporary cache
// suffix; exposing a stable pseudo-euid lets it take its platform-neutral path.
if (process.platform === 'win32') {
  const os = require('node:os')
  const driveHome =
    process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : undefined
  const homedir = process.env.USERPROFILE || driveHome || 'C:\\'
  const username = process.env.USERNAME || 'windows-user'
  os.userInfo = () => ({ uid: -1, gid: -1, username, homedir, shell: null })
  if (typeof process.geteuid !== 'function') process.geteuid = () => 0
}
