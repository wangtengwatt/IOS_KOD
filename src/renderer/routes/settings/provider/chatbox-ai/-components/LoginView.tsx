import { Alert, Anchor, Button, Flex, Image, Paper, Stack, Text, Title } from '@mantine/core'
import { IconCircleCheckFilled, IconFingerprint } from '@tabler/icons-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { consumeKodAuthReturnTo } from '@/packages/kodAuthReturn'
import { getKaiIdentityConfig, loginWithKaiIdentity } from '@/packages/remote'
import platform from '@/platform'
import { router } from '@/router'
import icon from '@/static/icon.png'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore } from '@/stores/settingsStore'
import { EmailCodeLoginModal } from './EmailCodeLoginModal'
import type { AuthTokens } from './types'

interface LoginViewProps {
  language: string
  saveAuthTokens: (tokens: AuthTokens) => Promise<void>
}

export const LoginView = forwardRef<HTMLDivElement, LoginViewProps>(({ language, saveAuthTokens }, ref) => {
  const { t } = useTranslation()
  const [loginModalOpened, setLoginModalOpened] = useState(false)
  const [kaiLoginLoading, setKaiLoginLoading] = useState(false)
  const [kaiLoginError, setKaiLoginError] = useState('')

  // 登录成功时，先清理 manual license，再保存 tokens
  const handleLoginSuccess = useCallback(
    async (tokens: AuthTokens) => {
      const settings = settingsStore.getState()
      if (settings.licenseKey && settings.licenseActivationMethod === 'manual') {
        await premiumActions.deactivate(false) // false = 不清除 login tokens
      }
      await saveAuthTokens({ ...tokens, email: tokens.email })
      const returnTo = consumeKodAuthReturnTo()
      if (returnTo === '/compute-center') {
        await router.navigate({ to: '/compute-center', search: {} })
      }
    },
    [saveAuthTokens]
  )

  const handleKaiIdentityLogin = useCallback(async () => {
    setKaiLoginError('')
    setKaiLoginLoading(true)
    try {
      if (!platform.supportsKaiIdentityLogin()) {
        throw new Error(String(t('KAI unified login is currently available in the KOD desktop and iOS apps')))
      }
      const config = await getKaiIdentityConfig()
      if (!config.enabled) {
        throw new Error(String(t('KAI unified login is not configured yet')))
      }
      const result = await platform.loginWithKaiIdentity(config)
      if (!result.success || !result.credentials?.accessToken) {
        throw new Error(result.error || String(t('KAI unified login failed')))
      }
      const tokens = await loginWithKaiIdentity(result.credentials.accessToken)
      await handleLoginSuccess(tokens)
    } catch (error) {
      setKaiLoginError(error instanceof Error ? error.message : String(error))
    } finally {
      setKaiLoginLoading(false)
    }
  }, [handleLoginSuccess, t])

  useEffect(() => {
    return () => {
      platform.cancelKaiIdentityLogin().catch(() => {})
    }
  }, [])

  return (
    <Stack gap="xl" ref={ref} style={{ position: 'relative' }}>
      <Stack gap="xs">
        <Flex align="center" justify="space-between">
          <Flex gap="md" align="center">
            <Image src={icon} w={48} h={48} />
          </Flex>
        </Flex>
        <Stack gap="0">
          <Title order={3} c="chatbox-primary">
            {t('Login to KOD AI')}
          </Title>
          <Text c="chatbox-tertiary">{t('Choose KOD email login or KAI unified identity login.')}</Text>
        </Stack>
      </Stack>
      <Stack gap="md">
        <Flex align="stretch" justify="center" direction="column" gap="sm">
          <Stack gap="xs">
            {kaiLoginError && (
              <Alert color="red" variant="light">
                {kaiLoginError}
              </Alert>
            )}
            <Button
              fullWidth
              onClick={() => {
                trackJkClickEvent(JK_EVENTS.LOGIN_BUTTON_CLICK, {
                  pageName: JK_PAGE_NAMES.SETTING_PAGE,
                })
                setLoginModalOpened(true)
              }}
            >
              {t('Login with KOD email')}
            </Button>
            <Button
              fullWidth
              variant="light"
              leftSection={<IconFingerprint size={18} />}
              loading={kaiLoginLoading}
              disabled={kaiLoginLoading || !platform.supportsKaiIdentityLogin()}
              onClick={() => void handleKaiIdentityLogin()}
            >
              {t('Login with KAI unified identity')}
            </Button>
            <Text c="chatbox-tertiary">
              {t('By continuing, you agree to our')}{' '}
              <Anchor size="sm" href="https://kod.kai.com/terms" target="_blank" underline="hover" c="chatbox-tertiary">
                {t('Terms of Service')}
              </Anchor>
              . {t('Read our')}{' '}
              <Anchor
                size="sm"
                href="https://kod.kai.com/privacy"
                target="_blank"
                underline="hover"
                c="chatbox-tertiary"
              >
                {t('Privacy Policy')}
              </Anchor>
              .
            </Text>
          </Stack>
        </Flex>
      </Stack>
      {/* promote card */}
      <Paper shadow="xs" p="sm" withBorder>
        <Stack gap="sm">
          <Text fw="600" c="chatbox-brand">
            {t('KOD AI offers a user-friendly AI solution to help you enhance productivity')}
          </Text>
          <Stack>
            {[
              t('Smartest AI-Powered Services for Rapid Access'),
              t('Vision, Drawing, File Understanding and more'),
              t('Hassle-free setup'),
              t('Ideal for work and study'),
            ].map((item) => (
              <Flex key={item} gap="xs" align="center">
                <ScalableIcon
                  icon={IconCircleCheckFilled}
                  className=" flex-shrink-0 flex-grow-0 text-chatbox-tint-brand"
                />
                <Text>{item}</Text>
              </Flex>
            ))}
          </Stack>
        </Stack>
      </Paper>

      <EmailCodeLoginModal
        opened={loginModalOpened}
        onClose={() => setLoginModalOpened(false)}
        language={language}
        onLoginSuccess={handleLoginSuccess}
      />
    </Stack>
  )
})

LoginView.displayName = 'LoginView'
