/**
 * ActionButton - Reusable button for login and provider settings actions
 */

import { Box, Button, Flex, Stack, Text } from '@mantine/core'
import { IconCirclePlus, IconCpu, IconExternalLink, IconInfoCircle, IconSettings } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { navigateToSettings } from '@/modals/Settings'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import { buildChatboxUrl } from '@/packages/remote'
import { EmailCodeLoginModal } from '@/routes/settings/provider/chatbox-ai/-components/EmailCodeLoginModal'
import type { AuthTokens } from '@/routes/settings/provider/chatbox-ai/-components/types'
import { authInfoStore } from '@/stores/authInfoStore'
import { settingsStore, useLanguage } from '@/stores/settingsStore'

interface LoginButtonProps {
  onLoginSuccess: () => void
}

const GUIDE_ACTION_BUTTON_MAX_WIDTH = 320
const guideActionButtonWidthStyle = {
  width: '100%',
  maxWidth: GUIDE_ACTION_BUTTON_MAX_WIDTH,
} as const

export function LoginButton({ onLoginSuccess }: LoginButtonProps) {
  const { t } = useTranslation()
  const language = useLanguage()
  const [hasSucceeded, setHasSucceeded] = useState(false)
  const [loginModalOpened, setLoginModalOpened] = useState(false)

  const handleLoginSuccessInternal = useCallback(
    async (tokens: AuthTokens) => {
      authInfoStore.getState().setTokens(tokens)
      setHasSucceeded(true)
      await onLoginSuccess()
    },
    [onLoginSuccess]
  )

  const trackLoginButtonClick = useCallback(() => {
    trackJkClickEvent(JK_EVENTS.LOGIN_BUTTON_CLICK, {
      pageName: JK_PAGE_NAMES.HELP_PAGE,
    })
  }, [])

  return (
    <>
      <Stack mt="md" gap="sm" style={guideActionButtonWidthStyle}>
        <Button
          onClick={() => {
            trackLoginButtonClick()
            setLoginModalOpened(true)
          }}
          disabled={hasSucceeded}
          variant="light"
          color={hasSucceeded ? 'green' : undefined}
          fullWidth
          h={42}
        >
          {hasSucceeded ? t('Login Successful') : t('Login to KOD AI')}
        </Button>
      </Stack>

      <EmailCodeLoginModal
        opened={loginModalOpened}
        onClose={() => setLoginModalOpened(false)}
        language={language}
        onLoginSuccess={handleLoginSuccessInternal}
      />
    </>
  )
}

export function ProviderSettingsButton() {
  const { t } = useTranslation()

  return (
    <Flex mt="md">
      <Button
        leftSection={<ScalableIcon icon={IconSettings} size={18} />}
        onClick={() => navigateToSettings('/provider')}
        variant="outline"
      >
        {t('Open Provider Settings')}
      </Button>
    </Flex>
  )
}

/**
 * 普通"新对话"按钮，用于引导完成后的正常跳转场景（登录成功、对话轮次上限等）
 * 对应 tool: show_new_chat_button（客户端本地生成）
 */
interface NewChatButtonProps {
  label?: string
}

export function NewChatButton({ label }: NewChatButtonProps = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Flex mt="md" style={guideActionButtonWidthStyle}>
      <Button variant="light" fullWidth h={42} onClick={() => navigate({ to: '/' })}>
        <ScalableIcon icon={IconCirclePlus} className="mr-2" />
        {label ?? t('New Chat')}
      </Button>
    </Flex>
  )
}

/**
 * 提示 block，用于用户误将引导助手当作普通对话时的引导提醒
 * 对应 tool: show_new_chat_tip（后端 AI 判断用户偏离话题时返回）
 */
export function NewChatTip() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Box
      mt="md"
      p="md"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--mantine-color-yellow-light)',
        border: '1px solid var(--mantine-color-yellow-light-color)',
      }}
    >
      <Flex align="center" gap="xs" mb={4}>
        <IconInfoCircle size={18} style={{ color: 'var(--mantine-color-yellow-8)', flexShrink: 0 }} />
        <Text size="sm" fw={600} style={{ color: 'var(--mantine-color-yellow-8)' }}>
          {t('This is the onboarding assistant')}
        </Text>
      </Flex>
      <Flex align="center" gap={6} wrap="wrap">
        <Text size="sm" c="dimmed">
          {t('For general conversations, please click')}
        </Text>
        <Button variant="light" size="compact-sm" onClick={() => navigate({ to: '/' })}>
          <ScalableIcon icon={IconCirclePlus} className="mr-1" />
          {t('New Chat')}
        </Button>
        <Text size="sm" c="dimmed">
          {t('on the side bar to start a new conversation.')}
        </Text>
      </Flex>
    </Box>
  )
}

export function ViewLicenseButton() {
  const language = useLanguage()
  const navigate = useNavigate()
  const label = language.startsWith('zh') ? '进入 KOD 算力中心' : 'Open KOD Compute Center'

  return (
    <Flex mt="xs" style={guideActionButtonWidthStyle}>
      <Button variant="light" fullWidth h={42} onClick={() => navigate({ to: '/compute-center' })}>
        <ScalableIcon icon={IconCpu} className="mr-2" />
        {label}
      </Button>
    </Flex>
  )
}

interface FreeTrialLinkProps {
  /** Optional hook that fires after the link successfully opens — used by the guide flow to start polling. */
  onAfterClick?: () => void
}

export function FreeTrialLink({ onAfterClick }: FreeTrialLinkProps = {}) {
  const { t } = useTranslation()
  const language = settingsStore.getState().language || 'en'
  const [pendingExternalAction, setPendingExternalAction] = useState(false)
  const pendingExternalActionRef = useRef(false)

  const handleClaimFreePlan = useCallback(async () => {
    if (pendingExternalActionRef.current) return

    pendingExternalActionRef.current = true
    setPendingExternalAction(true)
    trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
      pageName: JK_PAGE_NAMES.HELP_PAGE,
      content: 'onboarding_guide',
    })
    try {
      await openLinkWithAuth(
        buildChatboxUrl(
          `/redirect_app/claim_free_plan/${language}/?utm_source=app&utm_content=guide_session_free_trial`
        )
      )
      onAfterClick?.()
    } finally {
      pendingExternalActionRef.current = false
      setPendingExternalAction(false)
    }
  }, [language, onAfterClick])

  return (
    <Flex mt="md">
      <Button
        leftSection={<ScalableIcon icon={IconExternalLink} size={18} />}
        onClick={() => void handleClaimFreePlan()}
        variant="light"
        style={guideActionButtonWidthStyle}
        h={42}
        loading={pendingExternalAction}
        disabled={pendingExternalAction}
      >
        {t('Claim Free Plan')}
      </Button>
    </Flex>
  )
}
