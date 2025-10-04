import { FileText, Scan, Cog, Download, Target, Filter, GitMerge, FileExport, Bell, FileBarChart } from 'lucide-react'

interface NodeType {
  id: string
  label: string
  icon: React.ElementType
  category: 'input' | 'scan' | 'process' | 'output'
}

const nodeTypes: NodeType[] = [
  // Input nodes
  { id: 'target-input', label: 'Target Input', icon: Target, category: 'input' },
  { id: 'file-upload', label: 'File Upload', icon: FileText, category: 'input' },
  
  // Scan nodes
  { id: 'subdomain-scanner', label: 'Subdomain Scanner', icon: Scan, category: 'scan' },
  { id: 'port-scanner', label: 'Port Scanner', icon: Scan, category: 'scan' },
  { id: 'vuln-scanner', label: 'Vulnerability Scanner', icon: Scan, category: 'scan' },
  
  // Process nodes
  { id: 'filter', label: 'Filter', icon: Filter, category: 'process' },
  { id: 'transform', label: 'Transform', icon: Cog, category: 'process' },
  { id: 'merge', label: 'Merge', icon: GitMerge, category: 'process' },
  
  // Output nodes
  { id: 'export', label: 'Export', icon: FileExport, category: 'output' },
  { id: 'alert', label: 'Alert', icon: Bell, category: 'output' },
  { id: 'report', label: 'Report', icon: FileBarChart, category: 'output' },
]

const categories = [
  { id: 'input', label: 'Input', color: 'text-blue-500' },
  { id: 'scan', label: 'Scan', color: 'text-orange-500' },
  { id: 'process', label: 'Process', color: 'text-purple-500' },
  { id: 'output', label: 'Output', color: 'text-green-500' },
]

export function Sidebar() {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="w-[280px] border-r bg-background p-4 overflow-y-auto">
      <h2 className="font-semibold mb-4">Components</h2>
      
      {categories.map((category) => (
        <div key={category.id} className="mb-6">
          <h3 className={`text-sm font-medium mb-2 ${category.color}`}>
            {category.label}
          </h3>
          <div className="space-y-2">
            {nodeTypes
              .filter((node) => node.category === category.id)
              .map((nodeType) => {
                const Icon = nodeType.icon
                return (
                  <div
                    key={nodeType.id}
                    className="flex items-center gap-2 p-2 border rounded-md cursor-move hover:bg-accent transition-colors"
                    draggable
                    onDragStart={(e) => onDragStart(e, nodeType.id)}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-sm">{nodeType.label}</span>
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}