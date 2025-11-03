import { useEffect, useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, ShieldCheck, Info } from 'lucide-react'
import { useAuthStore, DEFAULT_ORG_ID } from '@/store/authStore'

export function AuthSettingsButton() {
  const { token, organizationId, setToken, setOrganizationId, clear } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [draftToken, setDraftToken] = useState(token ?? '')
  const [draftOrg, setDraftOrg] = useState(organizationId ?? DEFAULT_ORG_ID)

  useEffect(() => {
    if (open) {
      setDraftToken(token ?? '')
      setDraftOrg(organizationId ?? DEFAULT_ORG_ID)
    }
  }, [open, token, organizationId])

  const isConfigured = useMemo(() => Boolean(token && token.length > 0), [token])
  const isLocalMode = useMemo(() => !token || token.trim().length === 0, [token])

  const handleSave = () => {
    setToken(draftToken.trim().length > 0 ? draftToken.trim() : null)
    setOrganizationId(draftOrg.trim().length > 0 ? draftOrg.trim() : DEFAULT_ORG_ID)
    setOpen(false)
  }

  const handleClearToken = () => {
    clear()
    setDraftToken('')
  }

  return (
    <div className="flex items-center gap-2">
      {/* Local Auth Info Balloon */}
      {isLocalMode && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-yellow-200/80 hover:text-yellow-100 hover:bg-yellow-400/10"
              title="Local auth mode information"
            >
              <Info className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-200" />
                <div className="space-y-2">
                  <div>
                    <p className="font-medium text-yellow-50">Local auth mode active</p>
                    <p className="text-xs text-yellow-100/90 mt-1">
                      Requests use the default organization{' '}
                      <code className="rounded bg-black/30 px-1 py-0.5 text-[11px]">
                        {organizationId ?? DEFAULT_ORG_ID}
                      </code>
                    </p>
                  </div>
                  <p className="text-xs text-yellow-100/80">
                    Provide a platform-issued token via the Configure Auth button to access organization-specific data.
                  </p>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Auth Settings Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant={isConfigured ? 'secondary' : 'outline'}
            size="sm"
            className="gap-2"
          >
            {isConfigured ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
            <span>{isConfigured ? 'Auth Configured' : 'Configure Auth'}</span>
            <Badge variant="outline" className="hidden sm:inline-flex">
              {organizationId ?? DEFAULT_ORG_ID}
            </Badge>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authentication Settings</DialogTitle>
            <DialogDescription>
              Provide a service token issued by the platform or leave the token blank for local
              development. Organization ID defaults to <code>{DEFAULT_ORG_ID}</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shipsec-auth-token">API token</Label>
              <Input
                id="shipsec-auth-token"
                type="password"
                autoComplete="off"
                value={draftToken}
                onChange={(event) => setDraftToken(event.target.value)}
                placeholder="Bearer token or service account secret"
              />
              <p className="text-xs text-muted-foreground">
                The token is added as an <code>Authorization</code> header on every API request.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shipsec-org-id">Organization ID</Label>
              <Input
                id="shipsec-org-id"
                value={draftOrg}
                onChange={(event) => setDraftOrg(event.target.value)}
                placeholder={DEFAULT_ORG_ID}
              />
              <p className="text-xs text-muted-foreground">
                Requests include this value as <code>X-Organization-Id</code>. Leave blank to use{' '}
                <code>{DEFAULT_ORG_ID}</code>.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {isConfigured && (
              <Button variant="ghost" onClick={handleClearToken}>
                Clear token
              </Button>
            )}
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
