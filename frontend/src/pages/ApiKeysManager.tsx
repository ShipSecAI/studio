import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Copy, Trash2, ShieldOff, AlertTriangle } from 'lucide-react';
import { useApiKeyStore } from '@/store/apiKeyStore';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import type { CreateApiKeyInput } from '@/schemas/apiKey';
import type { components } from '@shipsec/backend-client';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];

const INITIAL_FORM: CreateApiKeyInput = {
    name: '',
    description: '',
    expiresAt: undefined,
    permissions: {
        workflows: {
            run: true, // Default to allowing run
            list: false,
            read: false,
        },
        runs: {
            read: true, // Default to allowing reading runs
            cancel: false,
        },
    },
};

function formatDate(iso: string) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(iso));
}

function truncateKey(keyHint: string) {
    return `...${keyHint}`;
}

export function ApiKeysManager() {
    const roles = useAuthStore((state) => state.roles);
    const canManageKeys = hasAdminRole(roles);
    const isReadOnly = !canManageKeys;

    const apiKeys = useApiKeyStore((state) => state.apiKeys);
    const loading = useApiKeyStore((state) => state.loading);
    const error = useApiKeyStore((state) => state.error);
    const fetchApiKeys = useApiKeyStore((state) => state.fetchApiKeys);
    const createApiKey = useApiKeyStore((state) => state.createApiKey);
    const revokeApiKey = useApiKeyStore((state) => state.revokeApiKey);
    const deleteApiKey = useApiKeyStore((state) => state.deleteApiKey);
    const lastCreatedKey = useApiKeyStore((state) => state.lastCreatedKey);
    const clearLastCreatedKey = useApiKeyStore((state) => state.clearLastCreatedKey);

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [formState, setFormState] = useState<CreateApiKeyInput>(INITIAL_FORM);
    const [createError, setCreateError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Revoke/Delete Confirmation
    const [confirmAction, setConfirmAction] = useState<{
        type: 'revoke' | 'delete';
        target: ApiKeyResponseDto;
    } | null>(null);

    useEffect(() => {
        fetchApiKeys().catch(console.error);
    }, [fetchApiKeys]);

    const handleCreateOpenChange = (open: boolean) => {
        setIsCreateOpen(open);
        if (!open) {
            setFormState(INITIAL_FORM);
            setCreateError(null);
            clearLastCreatedKey(); // Clear sensitive key if dialog closed
        }
    };

    const handleInputChange = (field: keyof CreateApiKeyInput, value: any) => {
        setFormState((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handlePermissionChange = (
        category: 'workflows' | 'runs',
        action: string,
        checked: boolean
    ) => {
        setFormState((prev) => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [category]: {
                    ...(prev.permissions[category] as any),
                    [action]: checked,
                },
            },
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canManageKeys) return;

        setCreateError(null);
        setIsSubmitting(true);

        try {
            await createApiKey(formState);
            setSuccessMessage('API Key created successfully.');
            // Don't close dialog yet because we need to show the key
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to create API key';
            setCreateError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const confirmRevokeOrDelete = async () => {
        if (!confirmAction) return;
        try {
            if (confirmAction.type === 'revoke') {
                await revokeApiKey(confirmAction.target.id);
                setSuccessMessage(`API Key "${confirmAction.target.name}" revoked.`);
            } else {
                await deleteApiKey(confirmAction.target.id);
                setSuccessMessage(`API Key "${confirmAction.target.name}" deleted.`);
            }
            setConfirmAction(null);
        } catch (err) {
            console.error(err);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        // You might want to show a toast here
    };

    return (
        <div className="flex-1 bg-background">
            <div className="container mx-auto py-8 px-4">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
                        <p className="text-muted-foreground mt-1">
                            Manage API keys for programmatic access to ShipSec.
                        </p>
                    </div>
                    <Button onClick={() => setIsCreateOpen(true)} disabled={isReadOnly}>
                        Create new key
                    </Button>
                </div>

                {error && (
                    <div className="mb-6 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div className="mb-6 rounded-md bg-green-500/10 p-4 text-sm text-green-600 dark:text-green-400">
                        {successMessage}
                    </div>
                )}

                <div className="border rounded-md bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Key Hint</TableHead>
                                <TableHead>Permissions</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead>Last Used</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && apiKeys.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center">
                                        Loading...
                                    </TableCell>
                                </TableRow>
                            ) : apiKeys.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                        No API keys found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                apiKeys.map((key) => (
                                    <TableRow key={key.id}>
                                        <TableCell className="font-medium">
                                            <div>{key.name}</div>
                                            {key.description && (
                                                <div className="text-xs text-muted-foreground">{key.description}</div>
                                            )}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {truncateKey(key.keyHint)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {Object.entries(key.permissions).map(([resource, actions]) =>
                                                    Object.entries(actions as Record<string, boolean>)
                                                        .filter(([, enabled]) => enabled)
                                                        .map(([action]) => (
                                                            <Badge key={`${resource}:${action}`} variant="secondary" className="text-[10px]">
                                                                {resource}:{action}
                                                            </Badge>
                                                        ))
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {key.isActive ? (
                                                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                                                    Active
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="bg-muted text-muted-foreground">
                                                    Revoked
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-xs">
                                            {formatDate(key.createdAt)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-xs">
                                            {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {key.isActive && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Revoke Key"
                                                    onClick={() => setConfirmAction({ type: 'revoke', target: key })}
                                                    disabled={isReadOnly}
                                                >
                                                    <ShieldOff className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                title="Delete Key"
                                                onClick={() => setConfirmAction({ type: 'delete', target: key })}
                                                disabled={isReadOnly}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Create Dialog */}
            <Dialog open={isCreateOpen} onOpenChange={handleCreateOpenChange}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Create new API Key</DialogTitle>
                        <DialogDescription>
                            Create a new API key to access ShipSec programmatically.
                        </DialogDescription>
                    </DialogHeader>

                    {lastCreatedKey ? (
                        <div className="space-y-4">
                            <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 mb-4">
                                <div className="flex">
                                    <div className="flex-shrink-0">
                                        <AlertTriangle className="h-5 w-5 text-yellow-400" aria-hidden="true" />
                                    </div>
                                    <div className="ml-3">
                                        <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                                            Save your secret key
                                        </h3>
                                        <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                                            <p>
                                                This is the only time we will show you the secret key. Make sure to copy it now.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Secret Key</Label>
                                <div className="flex items-center gap-2">
                                    <Input readOnly value={lastCreatedKey} className="font-mono bg-muted" />
                                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(lastCreatedKey)}>
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={() => handleCreateOpenChange(false)}>Done</Button>
                            </DialogFooter>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    placeholder="e.g. CI/CD Runner"
                                    value={formState.name}
                                    onChange={(e) => handleInputChange('name', e.target.value)}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">Description (Optional)</Label>
                                <Input
                                    id="description"
                                    placeholder="What is this key used for?"
                                    value={formState.description || ''}
                                    onChange={(e) => handleInputChange('description', e.target.value)}
                                />
                            </div>

                            <div className="space-y-3">
                                <Label>Permissions</Label>
                                <div className="grid grid-cols-2 gap-4 border p-3 rounded-md">
                                    <div className="space-y-2">
                                        <Label className="text-xs uppercase text-muted-foreground font-semibold">Workflows</Label>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="perm-wf-run"
                                                checked={formState.permissions.workflows.run}
                                                onCheckedChange={(checked) =>
                                                    handlePermissionChange('workflows', 'run', checked as boolean)
                                                }
                                            />
                                            <Label htmlFor="perm-wf-run" className="font-normal text-sm">Run Workflows</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="perm-wf-list"
                                                checked={formState.permissions.workflows.list}
                                                onCheckedChange={(checked) =>
                                                    handlePermissionChange('workflows', 'list', checked as boolean)
                                                }
                                            />
                                            <Label htmlFor="perm-wf-list" className="font-normal text-sm">List Workflows</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="perm-wf-read"
                                                checked={formState.permissions.workflows.read}
                                                onCheckedChange={(checked) =>
                                                    handlePermissionChange('workflows', 'read', checked as boolean)
                                                }
                                            />
                                            <Label htmlFor="perm-wf-read" className="font-normal text-sm">Read Workflows</Label>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-xs uppercase text-muted-foreground font-semibold">Runs</Label>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="perm-run-read"
                                                checked={formState.permissions.runs.read}
                                                onCheckedChange={(checked) =>
                                                    handlePermissionChange('runs', 'read', checked as boolean)
                                                }
                                            />
                                            <Label htmlFor="perm-run-read" className="font-normal text-sm">Read Runs</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="perm-run-cancel"
                                                checked={formState.permissions.runs.cancel}
                                                onCheckedChange={(checked) =>
                                                    handlePermissionChange('runs', 'cancel', checked as boolean)
                                                }
                                            />
                                            <Label htmlFor="perm-run-cancel" className="font-normal text-sm">Cancel Runs</Label>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {createError && <p className="text-sm text-destructive">{createError}</p>}

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => handleCreateOpenChange(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={isSubmitting || !formState.name}>
                                    {isSubmitting ? 'Creating...' : 'Create Key'}
                                </Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            {/* Confirmation Dialog */}
            <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {confirmAction?.type === 'revoke' ? 'Revoke API Key' : 'Delete API Key'}
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to {confirmAction?.type} the key "
                            <span className="font-medium text-foreground">{confirmAction?.target.name}</span>"?
                            {confirmAction?.type === 'revoke'
                                ? ' Applications using this key will immediately stop working.'
                                : ' This action cannot be undone.'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmAction(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant={confirmAction?.type === 'delete' ? 'destructive' : 'default'}
                            onClick={confirmRevokeOrDelete}
                        >
                            Confirm
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
