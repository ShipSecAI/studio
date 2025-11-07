import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SecretSummary } from '@/schemas/secret'
import { useSecretStore } from '@/store/secretStore'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { track, Events } from '@/features/analytics/events'

interface FormState {
  name: string
  description: string
  tags: string
  value: string
}

type EditFormState = Pick<FormState, 'name' | 'description' | 'tags' | 'value'>

const INITIAL_FORM: FormState = {
  name: '',
  description: '',
  tags: '',
  value: '',
}

const INITIAL_EDIT_FORM: EditFormState = {
  name: '',
  description: '',
  tags: '',
  value: '',
}

function parseTags(raw: string): string[] | undefined {
  if (!raw.trim()) {
    return undefined
  }

  const tags = raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)

  return tags.length > 0 ? tags : undefined
}

function formatTags(tags?: string[] | null): string {
  return tags?.join(', ') ?? ''
}

function normalizeDescriptionInput(raw: string): string {
  return raw.trim()
}

function normalizeTagsForUpdate(raw: string): string[] {
  const tags = parseTags(raw)
  return tags ?? []
}

function areTagsEqual(current: string[] | null | undefined, next: string[]): boolean {
  if (!current || current.length === 0) {
    return next.length === 0
  }
  if (current.length !== next.length) {
    return false
  }
  const normalizedCurrent = [...current].sort()
  const normalizedNext = [...next].sort()
  return normalizedCurrent.every((tag, index) => tag === normalizedNext[index])
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function SecretsManager() {
  const roles = useAuthStore((state) => state.roles)
  const canManageSecrets = hasAdminRole(roles)
  const isReadOnly = !canManageSecrets
  const secrets = useSecretStore((state) => state.secrets)
  const loading = useSecretStore((state) => state.loading)
  const error = useSecretStore((state) => state.error)
  const fetchSecrets = useSecretStore((state) => state.fetchSecrets)
  const refreshSecrets = useSecretStore((state) => state.refresh)
  const createSecret = useSecretStore((state) => state.createSecret)
  const updateSecretMetadata = useSecretStore((state) => state.updateSecret)
  const deleteSecretEntry = useSecretStore((state) => state.deleteSecret)
  const rotateSecretValue = useSecretStore((state) => state.rotateSecret)

  const [formState, setFormState] = useState<FormState>(INITIAL_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const disableCreate = isReadOnly || isSubmitting

  const [listSuccess, setListSuccess] = useState<string | null>(null)

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingSecret, setEditingSecret] = useState<SecretSummary | null>(null)
  const [editFormState, setEditFormState] = useState<EditFormState>(INITIAL_EDIT_FORM)
  const [editError, setEditError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const disableEditing = isReadOnly || isEditing

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SecretSummary | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const disableDeleting = isReadOnly || isDeleting

  useEffect(() => {
    fetchSecrets().catch((err) => {
      console.error('Failed to load secrets', err)
    })
  }, [fetchSecrets])

  useEffect(() => {
    if (error) {
      setListSuccess(null)
    }
  }, [error])

  const handleChange =
    (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormState((prev) => ({
        ...prev,
        [field]: event.target.value,
      }))
    }

  const handleEditChange =
    (field: keyof EditFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setEditFormState((prev) => ({
        ...prev,
        [field]: event.target.value,
      }))
    }

  const isFormValid = useMemo(() => {
    return formState.name.trim().length > 0 && formState.value.trim().length > 0
  }, [formState.name, formState.value])

  const isEditValid = useMemo(() => {
    return editFormState.name.trim().length > 0
  }, [editFormState.name])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setFormSuccess(null)
    setListSuccess(null)

    if (!canManageSecrets) {
      setFormError('Only workspace administrators can create or update secrets.')
      return
    }

    if (!isFormValid) {
      setFormError('Name and secret value are required.')
      return
    }

    setIsSubmitting(true)
    const normalizedName = formState.name.trim()
    const normalizedTags = parseTags(formState.tags)
    try {
      await createSecret({
        name: normalizedName,
        value: formState.value,
        description: formState.description.trim() || undefined,
        tags: normalizedTags,
      })
      // Avoid leaking raw secret identifiers to analytics; send derived metadata only.
      track(Events.SecretCreated, {
        has_tags: Boolean(normalizedTags?.length),
        tag_count: normalizedTags?.length,
        name_length: normalizedName.length,
      })
      setFormSuccess('Secret created successfully. You can now reference it from workflows.')
      setFormState(INITIAL_FORM)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create secret'
      setFormError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openEditDialog = (secret: SecretSummary) => {
    setListSuccess(null)
    setEditingSecret(secret)
    setEditFormState({
      name: secret.name,
      description: secret.description ?? '',
      tags: formatTags(secret.tags),
      value: '',
    })
    setEditError(null)
    setIsEditDialogOpen(true)
  }

  const handleEditDialogChange = (open: boolean) => {
    setIsEditDialogOpen(open)
    if (!open) {
      setEditingSecret(null)
      setEditFormState(INITIAL_EDIT_FORM)
      setEditError(null)
      setIsEditing(false)
    }
  }

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingSecret) {
      return
    }

    if (!canManageSecrets) {
      setEditError('Only workspace administrators can modify secrets.')
      return
    }

    setEditError(null)
    setListSuccess(null)
    setIsEditing(true)

    const trimmedName = editFormState.name.trim()
    const normalizedDescription = normalizeDescriptionInput(editFormState.description)
    const existingDescription = normalizeDescriptionInput(editingSecret.description ?? '')
    const normalizedTags = normalizeTagsForUpdate(editFormState.tags)
    const newSecretValue = editFormState.value.trim()

    const metadataChanged =
      trimmedName !== editingSecret.name ||
      normalizedDescription !== existingDescription ||
      !areTagsEqual(editingSecret.tags, normalizedTags)
    const shouldRotate = newSecretValue.length > 0

    try {
      let latest = editingSecret

      if (metadataChanged) {
        latest = await updateSecretMetadata(editingSecret.id, {
          name: trimmedName,
          description: normalizedDescription,
          tags: normalizedTags,
        })
      }

      if (shouldRotate) {
        latest = await rotateSecretValue(editingSecret.id, { value: newSecretValue })
      }

      const actions: string[] = []
      if (metadataChanged) actions.push('updated')
      if (shouldRotate) actions.push('rotated')
      const actionSummary =
        actions.length === 0 ? 'unchanged' : `${actions.join(' and ')} successfully`

      setListSuccess(`Secret "${latest.name}" ${actionSummary}.`)
      handleEditDialogChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update secret'
      setEditError(message)
    } finally {
      setIsEditing(false)
    }
  }

  const openDeleteDialog = (secret: SecretSummary) => {
    setListSuccess(null)
    setDeleteTarget(secret)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  const handleDeleteDialogChange = (open: boolean) => {
    setIsDeleteDialogOpen(open)
    if (!open) {
      setDeleteTarget(null)
      setDeleteError(null)
      setIsDeleting(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return
    }

    if (!canManageSecrets) {
      setDeleteError('Only workspace administrators can delete secrets.')
      return
    }

    setDeleteError(null)
    setListSuccess(null)
    setIsDeleting(true)

    const secretName = deleteTarget.name
    const secretNameLength = secretName.trim().length

    try {
      await deleteSecretEntry(deleteTarget.id)
      // Avoid emitting the raw secret name to analytics.
      track(Events.SecretDeleted, { name_length: secretNameLength })
      setListSuccess(`Secret "${secretName}" deleted.`)
      handleDeleteDialogChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete secret'
      setDeleteError(message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-4">
        {isReadOnly && (
          <div className="mb-6 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            You have read-only access. Viewing secrets metadata is allowed, but only administrators
            can create, rotate, or delete secrets.
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Secret Manager</h2>
          <p className="text-muted-foreground">
            Store API keys, credentials, and tokens for use in workflows and security components.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
          <div className="border rounded-lg bg-card p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold mb-1">Add a new secret</h2>
              <p className="text-sm text-muted-foreground">
                Secret values are encrypted at rest. The plaintext you provide here is only used during creation.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label htmlFor="secret-name" className="text-sm font-medium">
                  Secret name
                </label>
                <Input
                  id="secret-name"
                  placeholder="ex: shodan-api-key"
                  value={formState.name}
                  onChange={handleChange('name')}
                  disabled={disableCreate}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="secret-description" className="text-sm font-medium">
                  Description
                  <span className="text-muted-foreground"> (optional)</span>
                </label>
                <Input
                  id="secret-description"
                  placeholder="Describe how this secret is used"
                  value={formState.description}
                  onChange={handleChange('description')}
                  disabled={disableCreate}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="secret-tags" className="text-sm font-medium">
                  Tags
                  <span className="text-muted-foreground"> (comma separated)</span>
                </label>
                <Input
                  id="secret-tags"
                  placeholder="prod, security, reconnaissance"
                  value={formState.tags}
                  onChange={handleChange('tags')}
                  disabled={disableCreate}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="secret-value" className="text-sm font-medium">
                  Secret value
                </label>
                <Textarea
                  id="secret-value"
                  placeholder="Paste the secret value"
                  value={formState.value}
                  onChange={handleChange('value')}
                  disabled={disableCreate}
                  rows={4}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  The plaintext is never shown again after creation.
                </p>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}

              {formSuccess && <p className="text-sm text-green-600">{formSuccess}</p>}

              <Button type="submit" disabled={!isFormValid || disableCreate}>
                {isSubmitting ? 'Saving…' : 'Create secret'}
              </Button>
            </form>
          </div>

          <div className="border rounded-lg bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">Stored secrets</h2>
                <p className="text-sm text-muted-foreground">
                  Only metadata is shown. Use the Secret Fetch component or parameter selectors to reference a secret.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setListSuccess(null)
                  refreshSecrets().catch((err) =>
                    console.error('Failed to refresh secrets', err),
                  )
                }}
                disabled={loading}
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>

            {error && <div className="mb-4 text-sm text-destructive">{error}</div>}
            {listSuccess && <div className="mb-4 text-sm text-green-600">{listSuccess}</div>}

            {loading && secrets.length === 0 ? (
              <div className="text-sm text-muted-foreground">Loading secrets…</div>
            ) : secrets.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No secrets yet. Use the form to create your first secret.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium">Tags</th>
                      <th className="py-2 pr-4 font-medium">Active Version</th>
                      <th className="py-2 pr-4 font-medium">Updated</th>
                      <th className="py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {secrets.map((secret) => (
                      <tr key={secret.id} className="border-t last:border-b">
                        <td className="py-3 pr-4 align-top">
                          <div className="font-medium">{secret.name}</div>
                          <div className="text-xs text-muted-foreground">
                            ID: <span className="font-mono">{secret.id}</span>
                          </div>
                          {secret.description && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {secret.description}
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 align-top">
                          <div className="flex flex-wrap gap-1">
                            {secret.tags?.length ? (
                              secret.tags.map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4 align-top">
                          {secret.activeVersion ? (
                            <div>
                              <div className="font-mono text-xs">v{secret.activeVersion.version}</div>
                              <div className="text-xs text-muted-foreground">
                                Created {formatDate(secret.activeVersion.createdAt)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No active version</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 align-top">
                          <div className="text-xs text-muted-foreground">
                            {formatDate(secret.updatedAt)}
                          </div>
                        </td>
                        <td className="py-3 align-top">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(secret)}
                              disabled={isReadOnly}
                              aria-disabled={isReadOnly}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => openDeleteDialog(secret)}
                              disabled={isReadOnly}
                              aria-disabled={isReadOnly}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={handleEditDialogChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit secret metadata</DialogTitle>
            <DialogDescription>
              Update the name, description, tags, or provide a new value to rotate this secret.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleEditSubmit}>
            <div className="space-y-2">
              <label htmlFor="edit-secret-name" className="text-sm font-medium">
                Secret name
              </label>
              <Input
                id="edit-secret-name"
                value={editFormState.name}
                onChange={handleEditChange('name')}
                disabled={disableEditing}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="edit-secret-description" className="text-sm font-medium">
                Description
                <span className="text-muted-foreground"> (optional)</span>
              </label>
              <Input
                id="edit-secret-description"
                value={editFormState.description}
                onChange={handleEditChange('description')}
                disabled={disableEditing}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="edit-secret-tags" className="text-sm font-medium">
                Tags
                <span className="text-muted-foreground"> (comma separated)</span>
              </label>
              <Input
                id="edit-secret-tags"
                value={editFormState.tags}
                onChange={handleEditChange('tags')}
                disabled={disableEditing}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="edit-secret-value" className="text-sm font-medium">
                New secret value<span className="text-muted-foreground"> (optional)</span>
              </label>
              <Textarea
                id="edit-secret-value"
                value={editFormState.value}
                onChange={handleEditChange('value')}
                disabled={disableEditing}
                rows={4}
                placeholder="Provide only if you want to rotate the secret"
              />
              <p className="text-xs text-muted-foreground">
                The plaintext encrypts immediately. Leave blank to keep the current value.
              </p>
            </div>

            {editError && <p className="text-sm text-destructive">{editError}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleEditDialogChange(false)}
                disabled={isEditing}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!isEditValid || disableEditing}>
                {isEditing ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete secret</DialogTitle>
            <DialogDescription>
              This action permanently removes the secret and its encrypted versions. Workflows referencing this secret will need to be updated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium">Secret:</span>{' '}
              <span>{deleteTarget?.name}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              ID: <span className="font-mono">{deleteTarget?.id}</span>
            </div>
            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDeleteDialogChange(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={disableDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete secret'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
