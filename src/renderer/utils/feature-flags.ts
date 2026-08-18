import platform from '@/platform'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

const hasCloudSandbox = platform.type === 'mobile' && CHATBOX_BUILD_PLATFORM === 'ios'

export const featureFlags = {
  mcp: platform.type === 'desktop' || hasCloudSandbox,
  knowledgeBase: platform.type === 'desktop' || hasCloudSandbox,
  // Skill metadata still syncs on iOS, but discovery/install/execute currently
  // depends on Electron IPC. Keep the UI hidden until the managed runner API
  // implements those operations end-to-end.
  skills: platform.type === 'desktop',
  taskMode: hasCloudSandbox,
}
