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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Report Templates</h1>
          <p className="text-gray-600 mt-1">Create and manage report templates for your security assessments</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          New Template
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {(['all', 'user', 'system'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'All Templates' : f === 'user' ? 'My Templates' : 'System Templates'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && filteredTemplates.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 mb-4">No templates found</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{template.name}</h3>
                    {template.isSystem && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        System
                      </span>
                    )}
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                      v{template.version}
                    </span>
                  </div>
                  {template.description && (
                    <p className="text-gray-600 text-sm mt-1">{template.description}</p>
                  )}
                  <p className="text-gray-400 text-xs mt-2">
                    Updated {new Date(template.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/templates/${template.id}/edit`)}
                    className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  {!template.isSystem && (
                    <button
                      onClick={() => deleteTemplate(template.id)}
                      className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Create New Template</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g., Penetration Test Report"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newTemplateDescription}
                  onChange={(e) => setNewTemplateDescription(e.target.value)}
                  placeholder="Brief description of this template..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTemplateName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
