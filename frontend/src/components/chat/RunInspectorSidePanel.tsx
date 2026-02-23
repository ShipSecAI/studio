import { useEffect } from 'react';
import { X, Activity } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useExecutionStore } from '@/store/executionStore';
import { ExecutionInspector } from '@/components/timeline/ExecutionInspector';

export function RunInspectorSidePanel() {
  const { isRunInspectorOpen, selectedRunId, setRunInspectorOpen, setSelectedRun } = useChatStore();
  const selectRun = useExecutionTimelineStore((state) => state.selectRun);
  const monitorRun = useExecutionStore((state) => state.monitorRun);
  const stopPolling = useExecutionStore((state) => state.stopPolling);

  // Keep timeline + live stream in sync with the selected run while inspector is open.
  useEffect(() => {
    if (!isRunInspectorOpen) {
      stopPolling();
      return;
    }

    if (selectedRunId) {
      void selectRun(selectedRunId, 'live');
      monitorRun(selectedRunId);
    }
  }, [selectedRunId, isRunInspectorOpen, selectRun, monitorRun, stopPolling]);

  const handleClose = () => {
    setRunInspectorOpen(false);
    stopPolling();
    // don't clear selectedRunId immediately to allow slide out animation
    setTimeout(() => {
      setSelectedRun(null);
    }, 300);
  };

  if (!isRunInspectorOpen || !selectedRunId) return null;

  return (
    <div className="relative w-[420px] shrink-0 h-full bg-background border-l flex flex-col animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="relative flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium">Run Inspector</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {selectedRunId.split('-').slice(0, 3).join('-')}
            </p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col relative w-full h-full pb-4">
        {/* We reuse the rock-solid ExecutionInspector here */}
        <ExecutionInspector />
      </div>
    </div>
  );
}
