import { type NodeProps } from 'reactflow'
import { NodeTerminalPanel } from '../terminal/NodeTerminalPanel'

interface TerminalNodeData {
  parentNodeId: string
  runId: string | null
  timelineSync: boolean
  onClose: () => void
}

export function TerminalNode({ data }: NodeProps<TerminalNodeData>) {
  return (
    <div className="nodrag nowheel nopan">
      <NodeTerminalPanel
        nodeId={data.parentNodeId}
        runId={data.runId}
        onClose={data.onClose}
        timelineSync={data.timelineSync}
      />
    </div>
  )
}

