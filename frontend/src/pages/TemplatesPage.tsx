import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTemplateStore } from '@/store/templateStore'
import { Trash2Icon, FileTextIcon } from 'lucide-react'

export function TemplatesPage() {
  const navigate = useNavigate()
  const { templates, loading, error, fetchTemplates, createTemplate, deleteTemplate } = useTemplateStore()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateDescription, setNewTemplateDescription] = useState('')
  const [filter, setFilter] = useState<'all' | 'user' | 'system'>('all')

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const filteredTemplates = templates.filter((t) => {
    if (filter === 'user') return !t.isSystem
    if (filter === 'system') return t.isSystem
    return true
  })

  const handleCreate = async () => {
    if (!newTemplateName.trim()) return

    try {
      const template = await createTemplate({
        name: newTemplateName,
        description: newTemplateDescription || undefined,
        content: { 
          template: DEFAULT_TEMPLATE_CODE,
          type: 'preact-htm'
        },
        inputSchema: DEFAULT_SCHEMA,
      })
      setShowCreateModal(false)
      setNewTemplateName('')
      setNewTemplateDescription('')
      navigate(`/templates/${template.id}/edit`)
    } catch (error) {
      console.error('Failed to create template:', error)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto bg-background text-foreground">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Report Templates</h1>
          <p className="text-muted-foreground mt-1">Create and manage report templates for your security assessments</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
        >
          New Template
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {(['all', 'user', 'system'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
          >
            {f === 'all' ? 'All Templates' : f === 'user' ? 'My Templates' : 'System Templates'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && filteredTemplates.length === 0 && (
        <div className="text-center py-12 bg-muted/50 rounded-lg border border-dashed border-border text-foreground">
          <p className="text-muted-foreground mb-4">No templates found</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Create Your First Template
          </button>
        </div>
      )}

      {!loading && !error && filteredTemplates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              onClick={() => navigate(`/templates/${template.id}/edit`)}
              className="bg-card border border-border rounded-xl p-4 shadow-sm hover:border-primary/50 hover:shadow-md transition-all group cursor-pointer flex flex-col h-full relative"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex flex-col gap-1 min-w-0">
                   <h3 className="font-semibold text-sm text-foreground truncate">{template.name}</h3>
                   <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] font-bold uppercase rounded-md border border-primary/20 shrink-0">
                        v{template.version}
                      </span>
                      {template.isSystem && (
                        <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-[9px] uppercase font-bold rounded-md border border-border shrink-0">
                          System
                        </span>
                      )}
                   </div>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!template.isSystem && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTemplate(template.id);
                      }}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                      title="Delete"
                    >
                      <Trash2Icon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              
              {/* Description */}
              {template.description ? (
                <p className="text-muted-foreground text-xs line-clamp-2 mb-4 min-h-[2.5em] leading-relaxed">{template.description}</p>
              ) : (
                <p className="text-muted-foreground/40 text-xs italic mb-4 min-h-[2.5em]">No description provided.</p>
              )}
              
              {/* Footer */}
              <div className="mt-auto pt-3 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1.5" title="Mock Usage Data">
                  <FileTextIcon className="w-3 h-3" />
                  <span>0 workflows</span>
                </div>
                <div>
                  Updated {new Date(template.updatedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold text-foreground mb-4">Create New Template</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g., Penetration Test Report"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-foreground placeholder:text-muted-foreground/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newTemplateDescription}
                  onChange={(e) => setNewTemplateDescription(e.target.value)}
                  placeholder="Brief description of this template..."
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-foreground placeholder:text-muted-foreground/50 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTemplateName.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Default template content to prevent render errors
const DEFAULT_TEMPLATE_CODE = `function Template({ data }) {
  return html\`
    <div style="font-family: sans-serif; padding: 40px; color: #333; text-align: center;">
      <h1 style="color: #2563eb; margin-bottom: 16px;">\${data.title || 'New Template'}</h1>
      <p style="color: #666;">This is a new template. Ask the AI Assistant to customize it!</p>
      <div style="margin-top: 32px; padding: 16px; background: #f9fafb; border-radius: 8px; font-size: 12px; color: #999;">
        Generated by ShipSec.ai
      </div>
    </div>
  \`;
}`;

const DEFAULT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", default: "My New Report" }
  }
};