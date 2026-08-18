import { Alert, Button, Checkbox, Flex, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconExternalLink, IconLogout, IconTrash } from '@tabler/icons-react'
import { forwardRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { Modal } from '@/components/layout/Overlay'
import platform from '@/platform'
import { AccountDeletedWithCleanupError, canDeleteAccount } from './accountDeletion'

interface LoggedInViewProps {
  onLogout: () => void
  onDeleteAccount: (password: string) => Promise<void>
}

export const LoggedInView = forwardRef<HTMLDivElement, LoggedInViewProps>(({ onLogout, onDeleteAccount }, ref) => {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetAndClose = useCallback(() => {
    setOpened(false)
    setPassword('')
    setConfirmation('')
    setAcknowledged(false)
    setError(null)
  }, [])
  const close = useCallback(() => {
    if (submitting) return
    resetAndClose()
  }, [resetAndClose, submitting])
  const submit = useCallback(async () => {
    if (submitting || !canDeleteAccount(password, confirmation, acknowledged)) return
    setSubmitting(true)
    setError(null)
    try {
      await onDeleteAccount(password)
      resetAndClose()
    } catch (cause) {
      if (cause instanceof AccountDeletedWithCleanupError) {
        resetAndClose()
        toast.warning(cause.message)
        return
      }
      setError(cause instanceof Error ? cause.message : t('Account deletion failed') || 'Account deletion failed')
    } finally {
      setSubmitting(false)
    }
  }, [acknowledged, confirmation, onDeleteAccount, password, resetAndClose, submitting, t])

  return (
    <Stack gap="xl" ref={ref}>
      <Flex gap="xs" align="center" justify="space-between">
        <Title order={3} c="chatbox-secondary">
          KOD
        </Title>
        <Button
          variant="transparent"
          c="chatbox-tertiary"
          px={0}
          h={24}
          onClick={() => platform.openLink('https://kod.kai.com')}
        >
          <ScalableIcon icon={IconExternalLink} size={24} />
        </Button>
      </Flex>
      <Paper shadow="xs" p="md" withBorder>
        <Stack gap="sm">
          <Text fw={600}>{t('You are logged in to KOD')}</Text>
          <Text c="chatbox-tertiary">
            {t('KOD will use the relay station URL and API key linked to this account to fetch models.')}
          </Text>
          <Flex justify="flex-end">
            <Button
              variant="light"
              color="chatbox-gray"
              leftSection={<ScalableIcon icon={IconLogout} size={14} />}
              onClick={() => void onLogout()}
            >
              {t('Logout')}
            </Button>
          </Flex>
        </Stack>
      </Paper>
      <Paper shadow="xs" p="md" withBorder style={{ borderColor: 'var(--mantine-color-red-5)' }}>
        <Stack gap="sm">
          <Text fw={600} c="red">
            {t('Danger zone')}
          </Text>
          <Text size="sm" c="chatbox-tertiary">
            {t(
              'Permanently delete your KOD account and its cloud data, then remove this account local chats, tasks, generated images, Suanbao data, preferences, credentials and caches from this device. Independent model-provider OAuth credentials are retained.'
            )}
          </Text>
          <Flex justify="flex-end">
            <Button
              color="red"
              variant="light"
              leftSection={<ScalableIcon icon={IconTrash} size={14} />}
              onClick={() => setOpened(true)}
            >
              {t('Delete account')}
            </Button>
          </Flex>
        </Stack>
      </Paper>
      <Modal
        opened={opened}
        onClose={close}
        centered
        title={t('Permanently delete KOD account')}
        closeOnClickOutside={!submitting}
        closeOnEscape={!submitting}
        withCloseButton={!submitting}
      >
        <Stack gap="md">
          <Alert color="red" variant="light" title={t('This cannot be undone')}>
            {t(
              'Your KOD account and cloud data will be permanently deleted. Local chats, task sessions, generated-image records and blobs, Suanbao data, account preferences, relay/provider/license data, caches and login tokens will also be removed. If deletion fails, you remain logged in and no local data is removed.'
            )}
          </Alert>
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <PasswordInput
            label={t('Current password (KOD email accounts only)')}
            description={t('Leave this blank if you signed in only through KAI unified identity.')}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            disabled={submitting}
          />
          <TextInput
            label={t('Type DELETE to confirm')}
            description={t('Enter the exact confirmation text: DELETE')}
            value={confirmation}
            onChange={(e) => setConfirmation(e.currentTarget.value)}
            disabled={submitting}
          />
          <Checkbox
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.currentTarget.checked)}
            disabled={submitting}
            label={t('I understand this permanently deletes my account and data.')}
          />
          <Flex justify="flex-end" gap="sm">
            <Button variant="light" color="chatbox-gray" onClick={close} disabled={submitting}>
              {t('Cancel')}
            </Button>
            <Button
              color="red"
              loading={submitting}
              disabled={!canDeleteAccount(password, confirmation, acknowledged)}
              onClick={() => void submit()}
            >
              {t('Permanently delete account')}
            </Button>
          </Flex>
        </Stack>
      </Modal>
    </Stack>
  )
})
LoggedInView.displayName = 'LoggedInView'
