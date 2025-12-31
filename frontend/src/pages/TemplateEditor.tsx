import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { components } from '@shipsec/backend-client'
import { useTemplateStore } from '@/store/templateStore'
import { TemplateChat } from '@/components/ai/TemplateChat'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/services/api'

type Template = components['schemas']['TemplateResponseDto']

export function TemplateEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { selectedTemplate, loading, error, selectTemplate, updateTemplate } = useTemplateStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [inputSchema, setInputSchema] = useState('')
  const [sampleData, setSampleData] = useState('')
  const [activeTab, setActiveTab] = useState<'content' | 'schema' | 'preview' | 'ai'>('content')
  const [saving, setSaving] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [showAIDrawer, setShowAIDrawer] = useState(false)

  useEffect(() => {
    if (id) {
      selectTemplate(id)
    }
  }, [id, selectTemplate])

  useEffect(() => {
    if (selectedTemplate) {
      setName(selectedTemplate.name)
      setDescription(selectedTemplate.description || '')
      setContent(JSON.stringify(selectedTemplate.content, null, 2))
      setInputSchema(JSON.stringify(selectedTemplate.inputSchema, null, 2))
      setSampleData(selectedTemplate.sampleData ? JSON.stringify(selectedTemplate.sampleData, null, 2) : '{}')
      generatePreview(selectedTemplate)
    }
  }, [selectedTemplate])

  const generatePreview = async (template: Template) => {
    try {
      const data = await api.templates.preview(template.id, {
        data: template.sampleData || {},
      })
      setPreviewHtml(data.renderedHtml || '<p>Preview not available</p>')
    } catch (error) {
      console.error('Failed to generate preview:', error)
      setPreviewHtml('<p>Preview generation failed</p>')
    }
  }

  const handleSave = async () => {
    if (!id || !selectedTemplate) return

    setSaving(true)
    try {
      let parsedContent: Record<string, unknown> = {}
      let parsedSchema: Record<string, unknown> = {}
      let parsedSampleData: Record<string, unknown> = {}

      try {
        parsedContent = JSON.parse(content)
      } catch (e) {
        console.error('Invalid JSON in content')
      }

      try {
        parsedSchema = JSON.parse(inputSchema)
      } catch (e) {
        console.error('Invalid JSON in schema')
      }

      try {
        parsedSampleData = JSON.parse(sampleData)
      } catch (e) {
        console.error('Invalid JSON in sample data')
      }

      await updateTemplate(id, {
        name,
        description,
        content: parsedContent,
        inputSchema: parsedSchema,
        sampleData: parsedSampleData,
      })

      if (activeTab === 'preview') {
        generatePreview({ ...selectedTemplate, name, description, content: parsedContent, inputSchema: parsedSchema, sampleData: parsedSampleData })
      }
    } catch (error) {
      console.error('Failed to save template:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleInsertTemplate = (templateContent: string) => {
    setContent(templateContent)
    setShowAIDrawer(false)
    setActiveTab('content')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      </div>
    )
  }

  if (!selectedTemplate) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">Template not found</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/templates')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-xl font-bold text-gray-900 bg-transparent border-none focus:ring-0 p-0"
              disabled={selectedTemplate.isSystem}
            />
            <p className="text-sm text-gray-500">
              Version {selectedTemplate.version} {selectedTemplate.isSystem && '• System Template'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAIDrawer(true)}
            className="px-4 py-2 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Assist
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r border-gray-200 p-4 overflow-y-auto">
          <h3 className="font-medium text-gray-900 mb-4">Template Details</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={selectedTemplate.isSystem}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sample Data (JSON)</label>
              <textarea
                value={sampleData}
                onChange={(e) => setSampleData(e.target.value)}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                disabled={selectedTemplate.isSystem}
              />
            </div>

            <button
              onClick={() => generatePreview({ ...selectedTemplate, sampleData: JSON.parse(sampleData) })}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Refresh Preview
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex border-b border-gray-200">
            {(['content', 'schema', 'preview', 'ai'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab === 'ai' ? (
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI Chat
                  </span>
                ) : (
                  tab.charAt(0).toUpperCase() + tab.slice(1)
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            {activeTab === 'content' && (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-full p-4 font-mono text-sm bg-gray-50 border-none focus:ring-0"
                disabled={selectedTemplate.isSystem}
              />
            )}

            {activeTab === 'schema' && (
              <textarea
                value={inputSchema}
                onChange={(e) => setInputSchema(e.target.value)}
                className="w-full h-full p-4 font-mono text-sm bg-gray-50 border-none focus:ring-0"
                disabled={selectedTemplate.isSystem}
              />
            )}

            {activeTab === 'preview' && (
              <div
                className="p-4 h-full overflow-auto bg-white"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}

            {activeTab === 'ai' && (
              <div className="h-full">
                <TemplateChat
                  onInsertTemplate={handleInsertTemplate}
                  systemPrompt="You are a report template generation expert for security assessments. Help users create and modify report templates using the custom template syntax with {{variable}}, {{#each}}, and {{#if}} directives. Generate professional HTML templates with inline styles."
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={showAIDrawer} onOpenChange={setShowAIDrawer}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI Template Generator
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <TemplateChat
              onInsertTemplate={handleInsertTemplate}
              systemPrompt="You are a report template generation expert for security assessments. Help users create and modify report templates using the custom template syntax with {{variable}}, {{#each}}, and {{#if}} directives. Generate professional HTML templates with inline styles."
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
