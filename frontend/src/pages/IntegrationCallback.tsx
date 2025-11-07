import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

import type { components } from '@shipsec/backend-client'
import { api } from '@/services/api'
import { getCurrentUserId } from '@/lib/currentUser'

type IntegrationConnection = components['schemas']['IntegrationConnectionResponse']

type CallbackStatus = 'pending' | 'success' | 'error'

export function IntegrationCallback() {
  const { provider } = useParams<{ provider: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const userId = useMemo(() => getCurrentUserId(), [])

  const [status, setStatus] = useState<CallbackStatus>('pending')
  const [message, setMessage] = useState('Exchanging authorization code…')
  const exchangeStartedRef = useRef(false)

  useEffect(() => {
    if (!provider) {
      setStatus('error')
      setMessage('Missing provider information in callback URL.')
      return
    }

    const providerId = provider

    const errorParam = searchParams.get('error')
    if (errorParam) {
      setStatus('error')
      setMessage(`Provider returned an error: ${errorParam}`)
      return
    }

    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code || !state) {
      setStatus('error')
      setMessage('Unable to complete OAuth without an authorization code and state.')
      return
    }

    if (exchangeStartedRef.current) {
      return
    }
    exchangeStartedRef.current = true

    const authCode = code
    const authState = state

    const redirectUri = `${window.location.origin}/integrations/callback/${providerId}`
    let cancelled = false

    async function exchangeCode() {
      try {
        const connection = await api.integrations.completeOAuth(providerId, {
          userId,
          code: authCode,
          state: authState,
          redirectUri,
        })

        if (cancelled) {
          return
        }

        broadcastConnection(connection)
        setStatus('success')
        setMessage(`Connected to ${connection.providerName}. Redirecting…`)
        setTimeout(() => {
          navigate(`/integrations?connected=${connection.provider}`, { replace: true })
        }, 1200)
      } catch (error) {
        if (cancelled) {
          return
        }
        const description =
          error instanceof Error ? error.message : 'Failed to exchange authorization code.'
        setStatus('error')
        setMessage(description)
      }
    }

    exchangeCode()

    return () => {
      cancelled = true
    }
  }, [navigate, provider, searchParams, userId])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="border rounded-lg bg-card shadow-sm p-8 max-w-md w-full text-center">
        <StatusIcon status={status} />
        <h1 className="text-xl font-semibold mb-2">
          {status === 'success' ? 'Connection ready' : status === 'error' ? 'Connection failed' : 'Completing OAuth'}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>

        {status !== 'pending' && (
          <Button variant="outline" onClick={() => navigate('/integrations')}>
            Return to connections
          </Button>
        )}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: CallbackStatus }) {
  if (status === 'pending') {
    return <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
  }

  if (status === 'success') {
    return <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
  }

  return <XCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
}

function broadcastConnection(connection: IntegrationConnection) {
  window.dispatchEvent(
    new CustomEvent<IntegrationConnection>('integration:connected', {
      detail: connection,
    }),
  )
}
