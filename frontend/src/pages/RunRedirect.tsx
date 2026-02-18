import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useExecutionRun } from '@/hooks/queries/useExecutionQueries';
import { Loader2 } from 'lucide-react';

/**
 * Redirect page for /runs/:runId
 *
 * Fetches the run to get its workflowId, then redirects to the correct URL:
 * /workflows/:workflowId/runs/:runId
 */
export function RunRedirect() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { data: run, error: queryError } = useExecutionRun(runId);

  useEffect(() => {
    if (run?.workflowId) {
      navigate(`/workflows/${run.workflowId}/runs/${runId}`, { replace: true });
    }
  }, [run, runId, navigate]);

  const error = !runId
    ? 'No run ID provided'
    : queryError
      ? 'Failed to load run'
      : run && !run.workflowId
        ? 'Run not found or missing workflow ID'
        : null;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-destructive">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 text-sm text-primary hover:underline"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading run...</span>
      </div>
    </div>
  );
}
