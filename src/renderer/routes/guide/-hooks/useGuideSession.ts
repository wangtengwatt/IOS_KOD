/**
 * Core hook for managing the Guide Session
 * Handles message state, API communication, and UI interactions
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { cancelConfetti, confetti } from '@/components/Confetti'
import platform from '@/platform'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import { onboardingStore, useOnboardingStore } from '@/stores/onboardingStore'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { GUIDE_CONFIG } from '../-utils/config'
import { type GuideMessage, sendGuideMessage } from '../-utils/guideApi'
import type {
  GuideMessagePart,
  GuideToolPart,
  GuideUIMessage,
  OnboardingStep,
  UseGuideSessionReturn,
  UserType,
} from './types'
import { parseStreamResponse } from './useStreamParser'
import {
  checkHasValidConfig,
  createNewChatButtonToolPart,
  createSuggestedQuestionsToolPart,
  generateMessageId,
  isGuideLanguageReady,
  shouldGuideEnterCompleted,
} from './utils'

// Re-export types for consumers
export type { GuideMessagePart, GuideTextPart, GuideToolName, GuideToolPart, GuideUIMessage, UserType } from './types'

/**
 * Creates a delay promise that can be tracked and cancelled.
 * The timeout ID is added to the provided Set and removed when completed.
 */
function createTrackedDelay(ms: number, pendingTimeouts: Set<ReturnType<typeof setTimeout>>): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingTimeouts.delete(timeoutId)
      resolve()
    }, ms)
    pendingTimeouts.add(timeoutId)
  })
}

function isChineseGuide(language: string) {
  return language.startsWith('zh')
}

function getKodGreeting(language: string) {
  if (isChineseGuide(language)) {
    return `## 👋 你好！我是 KOD 新手助手

KOD 是集 **AI 对话、生图、零售站切换与算力交易** 于一体的客户端。

### 核心功能
- 💬 **AI 对话与生图** — 使用 KAI 公司零售站提供的模型能力
- 🔄 **零售站与节点切换** — 保留手动选择零售站和节点的灵活流程
- 🖥️ **KOD 算力中心** — 购买 Token 套餐、预订 GPU，也可认证后发布闲置算力
- 🔐 **本地优先** — 会话和个人配置优先保存在本机

### 常用入口
- [KOD 官网控制台](https://kod.kai.com/console)
- [人民币钱包与充值](https://kod.kai.com/console/wallet)

---

**现在开始配置 KOD。** 请先选择你的使用方式：`
  }

  return `## 👋 Hi! I'm the KOD onboarding assistant

KOD brings together **AI chat, image generation, retail-station switching, and compute trading** in one client.

### Core features
- 💬 **AI chat and image generation** powered by KAI retail stations
- 🔄 **Manual retail-station and node switching**
- 🖥️ **KOD Compute Center** for Token packages, GPU reservations, and verified compute suppliers
- 🔐 **Local-first storage** for conversations and personal settings

### Useful links
- [KOD Console](https://kod.kai.com/console)
- [Wallet and top-up](https://kod.kai.com/console/wallet)

---

**Let's set up KOD.** First, choose how you want to continue:`
}

function getKodCompletedMessage(language: string) {
  return isChineseGuide(language)
    ? '你已完成 KOD 初始化，可以正常使用对话、生图和算力中心。如果还有问题，可以继续在这里提问。'
    : 'KOD setup is complete. You can now use chat, image generation, and the Compute Center. You can keep asking questions here.'
}

function getKodLoginIntroduction(language: string) {
  return isChineseGuide(language)
    ? '很好！登录 KOD 后即可同步你的人民币钱包、卡时、零售站配置和算力中心资产。\n\n点击下方登录按钮，输入邮箱和密码；只有首次注册新账号时才需要邀请码和邮箱验证码。'
    : 'Great! Sign in to KOD to access your RMB wallet, card-hours, retail-station configuration, and Compute Center assets.\n\nClick the button below and enter your email and password. An invitation code and email verification code are only required when registering a new account.'
}

function getKodCelebrationMessage(language: string) {
  return isChineseGuide(language)
    ? '登录成功，KOD 已准备就绪！你可以点击下方的**新对话**开始聊天，也可以进入 **KOD 算力中心**查看钱包、卡时、Token 套餐和 GPU 订单。'
    : 'Sign-in succeeded and KOD is ready. Start with **New Chat**, or open the **KOD Compute Center** to view your wallet, card-hours, Token packages, and GPU orders.'
}

export function useGuideSession(): UseGuideSessionReturn {
  const { t, i18n } = useTranslation()

  const [messages, setMessages] = useState<GuideUIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasValidConfig, setHasValidConfig] = useState(checkHasValidConfig)
  const [userTypeSelected, setUserTypeSelected] = useState<UserType | null>(null)
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('greeting')
  const [forceSelectionOnce, setForceSelectionOnce] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingUpdateRef = useRef<number | null>(null)
  /** markGuideCompleted body has run once. */
  const completionTriggeredRef = useRef(false)
  /** awaiting-card has been pushed once (idempotency for repeated Claim Free Plan clicks). */
  const claimWaitingShownRef = useRef(false)
  /** celebration message has been pushed once (terminal). */
  const celebrationShownRef = useRef(false)
  const greetingInitializedRef = useRef(false)
  const greetingCancelRef = useRef<(() => void) | null>(null)
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const onboardingCompleted = useOnboardingStore((s) => s.completed)
  const language = useSettingsStore((s) => s.language)
  const languageInited = useSettingsStore((s) => s.languageInited)
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const refreshToken = useAuthInfoStore((s) => s.refreshToken)
  const isLoggedIn = Boolean(accessToken && refreshToken)

  const isLanguageReady = useMemo(
    () => isGuideLanguageReady(languageInited, language, i18n.language),
    [languageInited, language, i18n.language]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current)
        pendingUpdateRef.current = null
      }
      if (greetingCancelRef.current) {
        greetingCancelRef.current()
        greetingCancelRef.current = null
      }
      // Clear all pending timeouts
      for (const timeoutId of pendingTimeoutsRef.current) {
        clearTimeout(timeoutId)
      }
      pendingTimeoutsRef.current.clear()
      // Cancel any active confetti animations
      cancelConfetti()
      // Reset greeting state so it can re-initialize on remount (React Strict Mode)
      greetingInitializedRef.current = false
    }
  }, [])

  // Calculate user message count for abuse prevention
  const userMessageCount = useMemo(() => messages.filter((m) => m.role === 'user').length, [messages])

  // Check if user can send messages (7-round limit for all users)
  const canSendMessage = useMemo(() => {
    return userMessageCount < GUIDE_CONFIG.maxRounds
  }, [userMessageCount])

  // Check if guide is in progress (has interactions)
  const isGuideInProgress = useMemo(
    () => messages.length > 1 || userTypeSelected !== null,
    [messages, userTypeSelected]
  )

  // Show temporary hint before language is fully initialized/switched.
  useEffect(() => {
    if (!isLanguageReady && messages.length === 0 && !greetingInitializedRef.current) {
      const hint = 'Detecting your language...'
      setMessages([
        {
          id: generateMessageId(),
          role: 'assistant',
          content: hint,
          parts: [{ type: 'text', text: hint }],
        },
      ])
    }
  }, [isLanguageReady, messages.length])

  // Initialize with greeting message when entering the guide
  // biome-ignore lint/correctness/useExhaustiveDependencies: greetingInitializedRef prevents re-execution
  useEffect(() => {
    if (!isLanguageReady || greetingInitializedRef.current) {
      return
    }
    greetingInitializedRef.current = true

    // Check config status first
    const configValid = checkHasValidConfig()
    setHasValidConfig(configValid)

    const enterCompleted =
      !forceSelectionOnce &&
      shouldGuideEnterCompleted({
        onboardingCompleted,
        isLoggedIn,
        hasValidConfig: configValid,
      })

    if (enterCompleted) {
      // User already has valid config, show completion message
      const configCompleteMsg = getKodCompletedMessage(language)
      setMessages([
        {
          id: generateMessageId(),
          role: 'assistant',
          content: configCompleteMsg,
          parts: [
            { type: 'text', text: configCompleteMsg },
            createNewChatButtonToolPart(`new-chat-btn-${Date.now()}`, {
              label: String(t('Click here to start a new chat')),
            }),
            createSuggestedQuestionsToolPart(`suggested-${Date.now()}`),
          ],
        },
      ])
      onboardingStore.getState().markCompleted()
      setOnboardingStep('completed')
    } else {
      if (forceSelectionOnce) {
        setForceSelectionOnce(false)
        setHasValidConfig(false)
      }
      // Show initial greeting with cards using fast streaming
      const greeting = getKodGreeting(language)

      // Stream greeting with fast speed
      const messageId = generateMessageId()
      const userTypeCardsPart: GuideToolPart = {
        type: 'tool-show_user_type_cards',
        toolCallId: 'initial-cards',
        toolName: 'show_user_type_cards',
        state: 'result',
        result: { displayed: true },
      }

      // Create placeholder message
      setMessages([
        {
          id: messageId,
          role: 'assistant',
          content: '',
          parts: [],
          isStreaming: true,
        },
      ])

      // Stream greeting asynchronously with cancellation support
      let cancelled = false

      void (async () => {
        const words = greeting.split(/(\s+)/)
        let accumulated = ''

        for (let i = 0; i < words.length; i++) {
          if (cancelled) return

          accumulated += words[i]
          const currentText = accumulated

          setMessages([
            {
              id: messageId,
              role: 'assistant',
              content: currentText,
              parts: [{ type: 'text', text: currentText }],
              isStreaming: true,
            },
          ])

          // Fast speed: 5-12ms per word
          await createTrackedDelay(5 + Math.random() * 7, pendingTimeoutsRef.current)
        }

        if (cancelled) return

        // Finalize with tool parts
        setMessages([
          {
            id: messageId,
            role: 'assistant',
            content: greeting,
            parts: [{ type: 'text', text: greeting }, userTypeCardsPart],
            isStreaming: false,
          },
        ])
      })()

      setOnboardingStep('selection') // Waiting for user to select a card

      // Store cancel function in ref for cleanup on unmount
      greetingCancelRef.current = () => {
        cancelled = true
      }
    }
  }, [isLanguageReady, t, resetKey, onboardingCompleted, isLoggedIn, forceSelectionOnce])

  /**
   * Append a fixed message to the conversation (instant, no streaming)
   */
  const appendFixedMessage = useCallback(
    (content: string, toolParts?: GuideToolPart[], role: 'user' | 'assistant' = 'assistant') => {
      const parts: GuideMessagePart[] = [{ type: 'text', text: content }]
      if (toolParts) {
        parts.push(...toolParts)
      }

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role,
          content,
          parts,
        },
      ])
    },
    []
  )

  /**
   * Stream a fixed message to simulate typing effect
   */
  const streamFixedMessage = useCallback(
    async (content: string, toolParts?: GuideToolPart[], options?: { speed?: 'normal' | 'fast' }) => {
      const messageId = generateMessageId()
      const speed = options?.speed ?? 'normal'

      // Create placeholder message with streaming state
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          role: 'assistant',
          content: '',
          parts: [],
          isStreaming: true,
        },
      ])

      // Helper to find and update message by ID (not by position)
      const updateMessageById = (
        updater: (msg: GuideUIMessage) => Partial<GuideUIMessage>
      ): ((prev: GuideUIMessage[]) => GuideUIMessage[]) => {
        return (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId)
          if (idx === -1) return prev
          return [...prev.slice(0, idx), { ...prev[idx], ...updater(prev[idx]) }, ...prev.slice(idx + 1)]
        }
      }

      // Simulate streaming by revealing characters progressively
      const words = content.split(/(\s+)/)
      let accumulated = ''

      // Speed settings: fast (10-25ms) for greeting, normal (30-70ms) for other messages
      const delayBase = speed === 'fast' ? 10 : 30
      const delayRange = speed === 'fast' ? 15 : 40

      for (let i = 0; i < words.length; i++) {
        accumulated += words[i]
        const currentText = accumulated

        setMessages(
          updateMessageById(() => ({
            content: currentText,
            parts: [{ type: 'text', text: currentText }],
          }))
        )

        await createTrackedDelay(delayBase + Math.random() * delayRange, pendingTimeoutsRef.current)
      }

      // Finalize message with tool parts
      const finalParts: GuideMessagePart[] = [{ type: 'text', text: content }]
      if (toolParts) {
        finalParts.push(...toolParts)
      }

      setMessages(
        updateMessageById(() => ({
          content,
          parts: finalParts,
          isStreaming: false,
        }))
      )
    },
    []
  )

  /**
   * Handle user type card selection
   */
  const selectUserType = useCallback(
    async (type: UserType) => {
      setUserTypeSelected(type)

      trackJkClickEvent(JK_EVENTS.ONBOARDING_CHOICE_CLICK, {
        pageName: JK_PAGE_NAMES.HELP_PAGE,
        content: type === 'novice' ? 'new_user' : 'skip_guide',
      })

      // Add user selection as a message (instant)
      const userContent = type === 'novice' ? t("I'm new to this") : t('Skip guide')
      appendFixedMessage(userContent, undefined, 'user')

      // Get the response content
      const responseContent =
        type === 'novice'
          ? getKodLoginIntroduction(language)
          : t(
              "Excellent! You're all set to explore on your own.\n\nClick the **Settings** icon in the sidebar, then go to **Model Providers** to configure your API key. If you need help later, just click the Help button in the bottom left corner. Enjoy!"
            )

      // Create appropriate tool parts based on selection
      let toolParts: GuideToolPart[] = []
      let shouldShowConfetti = false

      if (type === 'novice') {
        toolParts = [
          {
            type: 'tool-show_login_button',
            toolCallId: `login-btn-${Date.now()}`,
            toolName: 'show_login_button',
            state: 'result',
            result: { displayed: true },
          },
        ]
        setOnboardingStep('login_flow')
      } else {
        // Expert/skip users configure on their own - mark as completed
        onboardingStore.getState().markCompleted()
        setOnboardingStep('completed')
        shouldShowConfetti = true
      }

      // Stream assistant response with typing effect
      await streamFixedMessage(responseContent, toolParts)

      // Show confetti after streaming completes
      if (shouldShowConfetti) {
        const timeoutId = setTimeout(() => {
          pendingTimeoutsRef.current.delete(timeoutId)
          confetti()
        }, 200)
        pendingTimeoutsRef.current.add(timeoutId)
      }
    },
    [appendFixedMessage, language, streamFixedMessage, t]
  )

  /**
   * Stream the terminal "you're all set" celebration message + CTAs + confetti.
   * Idempotent: subsequent calls are no-ops.
   */
  const renderCelebration = useCallback(async () => {
    if (celebrationShownRef.current) return
    celebrationShownRef.current = true

    setOnboardingStep('completed')
    const baseTimestamp = Date.now()

    await streamFixedMessage(getKodCelebrationMessage(language), [
      createNewChatButtonToolPart(`new-chat-btn-${baseTimestamp}`),
      {
        type: 'tool-show_view_license_button',
        toolCallId: `view-license-btn-${baseTimestamp}`,
        toolName: 'show_view_license_button',
        state: 'result',
        result: { displayed: true },
      },
      {
        type: 'tool-show_suggested_questions',
        toolCallId: `suggested-questions-${baseTimestamp}`,
        toolName: 'show_suggested_questions',
        state: 'result',
        result: { displayed: true },
      },
    ])

    const timeoutId = setTimeout(() => {
      pendingTimeoutsRef.current.delete(timeoutId)
      confetti()
    }, 200)
    pendingTimeoutsRef.current.add(timeoutId)
  }, [language, streamFixedMessage])

  /**
   * Mark the guide flow as completed.
   *
   * Saves the completed state and enters the KOD-native success flow. KOD accounts use
   * wallet/card-hour entitlements rather than the upstream Chatbox license-claim flow.
   */
  const markGuideCompleted = useCallback(async () => {
    if (completionTriggeredRef.current) return
    completionTriggeredRef.current = true

    // Finalize any in-flight streaming message (e.g., AI preamble that preceded an activate_license tool call)
    setMessages((prev) => {
      const lastIdx = prev.length - 1
      if (lastIdx >= 0 && prev[lastIdx]?.isStreaming) {
        return [...prev.slice(0, lastIdx), { ...prev[lastIdx], isStreaming: false }]
      }
      return prev
    })

    setHasValidConfig(true)
    onboardingStore.getState().markCompleted()

    await renderCelebration()
  }, [renderCelebration])

  /**
   * Triggered by FreeTrialLink after the claim page successfully opens. Streams the awaiting card
   * which owns the polling lifecycle. Idempotent: re-clicking Claim does not stack cards.
   */
  const onClaimStart = useCallback(async () => {
    if (claimWaitingShownRef.current) return
    claimWaitingShownRef.current = true

    await streamFixedMessage(
      isChineseGuide(language)
        ? '请在 KOD 官网完成操作，完成后客户端会自动更新状态。'
        : 'Complete the action on the KOD website. The client will update automatically.',
      [
        {
          type: 'tool-show_claim_waiting',
          toolCallId: `claim-waiting-${Date.now()}`,
          toolName: 'show_claim_waiting',
          state: 'result',
          result: { displayed: true },
        },
      ]
    )
  }, [language, streamFixedMessage])

  /**
   * Triggered by useClaimPolling when a license appears in the user's account. Activates locally
   * and runs the celebration. Activation failure is logged but does not block the celebration —
   * the license is real, the user can re-validate via Settings later.
   */
  const onClaimDetected = useCallback(
    async (license: import('@/packages/remote').UserLicense) => {
      try {
        await premiumActions.activate(license.key, 'login')
      } catch (err) {
        console.error('[guide] auto-activate after free-plan claim failed:', err)
      }
      await renderCelebration()
    },
    [renderCelebration]
  )

  /**
   * Handle config completion (for expert users returning from settings)
   */
  const handleConfigComplete = useCallback(() => {
    // Prevent duplicate completion
    if (completionTriggeredRef.current) return

    // Check if config is now valid
    const configValid = checkHasValidConfig()
    if (configValid && !hasValidConfig) {
      completionTriggeredRef.current = true
      setHasValidConfig(true)
      onboardingStore.getState().markCompleted()
      setOnboardingStep('completed')
      appendFixedMessage(getKodCompletedMessage(language), [
        createNewChatButtonToolPart(`new-chat-btn-${Date.now()}`, {
          label: String(t('Click here to start a new chat')),
        }),
        createSuggestedQuestionsToolPart(`suggested-${Date.now()}`),
      ])
    }
  }, [hasValidConfig, appendFixedMessage, language, t])

  /**
   * Send a free-form message to the backend API
   */
  const sendMessage = useCallback(
    async (content: string) => {
      // Add user message first
      const userMessage: GuideUIMessage = {
        id: generateMessageId(),
        role: 'user',
        content,
        parts: [{ type: 'text', text: content }],
      }
      setMessages((prev) => [...prev, userMessage])

      // Check if this message triggers the limit
      if (userMessageCount + 1 >= GUIDE_CONFIG.maxRounds) {
        if (hasValidConfig) {
          await streamFixedMessage(
            t(
              "I'm a bit tired now. Please click the **New Chat** button in the sidebar or below to start a new conversation."
            ),
            [
              {
                type: 'tool-show_new_chat_button',
                toolCallId: `new-chat-btn-limit-${Date.now()}`,
                toolName: 'show_new_chat_button',
                state: 'result',
                result: { displayed: true },
              },
            ]
          )
        } else {
          await streamFixedMessage(
            t(
              "We've been chatting for a while now. To conserve resources, please complete the setup before continuing our conversation."
            )
          )
        }
        return
      }

      // Create assistant placeholder message
      const assistantMessage: GuideUIMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: '',
        parts: [],
        isStreaming: true,
      }
      setMessages((prev) => [...prev, assistantMessage])

      setIsLoading(true)
      setError(null)

      // Create abort controller
      abortControllerRef.current = new AbortController()

      try {
        // Prepare messages for API
        const apiMessages: GuideMessage[] = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role,
            content: m.content,
          }))
        apiMessages.push({ role: 'user', content })

        // Send request with current onboarding step
        const { uuid: deviceId } = await platform.getConfig()
        const response = await sendGuideMessage(apiMessages, deviceId, {
          onboardingStep,
          isLoggedIn,
          signal: abortControllerRef.current.signal,
        })

        if (!response.body) {
          throw new Error('No response body')
        }

        // Parse streaming response
        await parseStreamResponse(response.body.getReader(), {
          setMessages,
          setOnboardingStep,
          pendingUpdateRef,
          pendingTimeouts: pendingTimeoutsRef.current,
          markGuideCompleted,
          t,
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // User cancelled, just mark streaming as done
          setMessages((prev) => {
            const lastIdx = prev.length - 1
            if (prev[lastIdx]?.isStreaming) {
              return [
                ...prev.slice(0, lastIdx),
                {
                  ...prev[lastIdx],
                  isStreaming: false,
                },
              ]
            }
            return prev
          })
        } else {
          console.error('Guide API error:', err)
          setError((err as Error).message || 'Failed to get response')
          // Remove only the assistant streaming placeholder, keep user messages
          setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.isStreaming)))
        }
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
      }
    },
    [userMessageCount, hasValidConfig, messages, onboardingStep, isLoggedIn, streamFixedMessage, markGuideCompleted, t]
  )

  /**
   * Stop the current generation
   */
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  /**
   * Clear the guide session and start fresh
   */
  const clearSession = useCallback(() => {
    // Cancel any ongoing streaming
    if (greetingCancelRef.current) {
      greetingCancelRef.current()
      greetingCancelRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    // Reset all state
    setMessages([])
    setUserTypeSelected(null)
    setError(null)
    setIsLoading(false)
    setOnboardingStep('greeting')
    completionTriggeredRef.current = false
    claimWaitingShownRef.current = false
    celebrationShownRef.current = false
    greetingInitializedRef.current = false
    // Trigger re-initialization
    setResetKey((k) => k + 1)
  }, [])

  /**
   * Debug: Reset guide and force entering selection step once.
   */
  const debugResetGuide = useCallback(() => {
    // Also reset auth/config to simulate a real new-user state.
    authInfoStore.getState().clearTokens()
    settingsStore.getState().setSettings((draft) => {
      draft.licenseKey = ''
      draft.licenseDetail = undefined
      draft.licenseActivationMethod = undefined
      draft.licenseInstances = undefined
      draft.memorizedManualLicenseKey = ''
      draft.providers = {}
    })

    onboardingStore.getState().reset()
    setHasValidConfig(false)
    setForceSelectionOnce(true)
    clearSession()
  }, [clearSession])

  /**
   * Debug: Skip directly to login success state for testing
   */
  const debugSkipToLoginSuccess = useCallback(() => {
    // Cancel any ongoing streaming
    if (greetingCancelRef.current) {
      greetingCancelRef.current()
      greetingCancelRef.current = null
    }
    // Clear current state
    setMessages([])
    setUserTypeSelected('novice')
    setHasValidConfig(true)
    setOnboardingStep('completed')
    completionTriggeredRef.current = true

    // Add the success message
    const successText = getKodCelebrationMessage(language)
    const successMessage: GuideUIMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: successText,
      parts: [
        { type: 'text', text: successText },
        {
          type: 'tool-show_new_chat_button',
          toolCallId: `new-chat-btn-debug-${Date.now()}`,
          toolName: 'show_new_chat_button',
          state: 'result',
          result: { displayed: true },
        },
        {
          type: 'tool-show_view_license_button',
          toolCallId: `view-license-btn-debug-${Date.now()}`,
          toolName: 'show_view_license_button',
          state: 'result',
          result: { displayed: true },
        },
        {
          type: 'tool-show_suggested_questions',
          toolCallId: `suggested-questions-debug-${Date.now()}`,
          toolName: 'show_suggested_questions',
          state: 'result',
          result: { displayed: true },
        },
      ],
    }

    setMessages([successMessage])
  }, [language])

  /**
   * Debug: Set state to just before round limit
   */
  const debugTriggerRoundLimit = useCallback(() => {
    // Cancel any ongoing streaming
    if (greetingCancelRef.current) {
      greetingCancelRef.current()
      greetingCancelRef.current = null
    }
    // Create fake user messages to reach the limit
    const fakeMessages: GuideUIMessage[] = []

    // Add greeting
    fakeMessages.push({
      id: generateMessageId(),
      role: 'assistant',
      content: isChineseGuide(language) ? '欢迎使用 KOD！' : 'Welcome to KOD!',
      parts: [{ type: 'text', text: isChineseGuide(language) ? '欢迎使用 KOD！' : 'Welcome to KOD!' }],
    })

    // Add maxRounds - 1 user messages, so next send triggers limit message
    for (let i = 0; i < GUIDE_CONFIG.maxRounds - 1; i++) {
      fakeMessages.push({
        id: generateMessageId(),
        role: 'user',
        content: `Test message ${i + 1}`,
        parts: [{ type: 'text', text: `Test message ${i + 1}` }],
      })
      fakeMessages.push({
        id: generateMessageId(),
        role: 'assistant',
        content: `Response ${i + 1}`,
        parts: [{ type: 'text', text: `Response ${i + 1}` }],
      })
    }

    setMessages(fakeMessages)
    setUserTypeSelected('novice')
    setOnboardingStep('login_flow')
  }, [language])

  return {
    messages,
    isLoading,
    error,
    onboardingStep,
    sendMessage,
    stopGeneration,
    selectUserType,
    markGuideCompleted,
    onClaimStart,
    onClaimDetected,
    handleConfigComplete,
    clearSession,
    debugResetGuide,
    debugSkipToLoginSuccess,
    debugTriggerRoundLimit,
    canSendMessage,
    hasValidConfig,
    userMessageCount,
    isGuideInProgress,
  }
}
