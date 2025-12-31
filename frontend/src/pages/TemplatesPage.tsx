import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTemplateStore } from '@/store/templateStore'

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
        content: {},
        inputSchema: {},
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
        <div className="grid gap-4">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{template.name}</h3>
                    {template.isSystem && (
                      <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded-full border border-border">
                        System
                      </span>
                    )}
                    <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full border border-primary/20">
                      v{template.version}
                    </span>
                  </div>
                  {template.description && (
                    <p className="text-muted-foreground text-sm mt-1">{template.description}</p>
                  )}
                  <p className="text-tertiary text-xs mt-2">
                    Updated {new Date(template.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/templates/${template.id}/edit`)}
                    className="px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors font-medium"
                  >
                    Edit
                  </button>
                  {!template.isSystem && (
                    <button
                      onClick={() => deleteTemplate(template.id)}
                      className="px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors font-medium"
                    >
                      Delete
                    </button>
                  )}
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
