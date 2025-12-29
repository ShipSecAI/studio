import { useEffect, useState } from 'react'
import { api } from '@/services/api'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, AlertCircle } from 'lucide-react'
import { HumanInputResolutionView, type HumanInputRequest } from './HumanInputResolutionView'

export function HumanInputDialog() {
    const { humanInputRequestId, humanInputDialogOpen, closeHumanInputDialog } = useWorkflowUiStore()

    const [request, setRequest] = useState<HumanInputRequest | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (humanInputDialogOpen && humanInputRequestId) {
            setLoading(true)
            setError(null)
            api.humanInputs.get(humanInputRequestId)
                .then(data => setRequest(data as unknown as HumanInputRequest))
                .catch(err => setError(err.message))
                .finally(() => setLoading(false))
        } else {
            setRequest(null)
        }
    }, [humanInputDialogOpen, humanInputRequestId])

    const isOpen = humanInputDialogOpen && !!humanInputRequestId

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && closeHumanInputDialog()}>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading request details...</p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
                        <AlertCircle className="h-8 w-8 text-destructive" />
                        <p className="text-sm text-destructive font-medium">{error}</p>
                        <Button variant="outline" onClick={closeHumanInputDialog}>Close</Button>
                    </div>
                ) : request ? (
                    <div className="overflow-y-auto px-1">
                        <HumanInputResolutionView
                            request={request}
                            onResolved={() => closeHumanInputDialog()}
                            onCancel={() => closeHumanInputDialog()}
                        />
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}
