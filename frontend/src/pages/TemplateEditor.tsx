import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTemplateStore } from '@/store/templateStore'
import { TemplateChat } from '@/components/ai/TemplateChat'
import {
  ArrowLeftIcon,
  EyeIcon,
  RefreshCwIcon,
  ZoomInIcon,
  ZoomOutIcon,
  LayoutListIcon,
  Code2Icon,
  SparklesIcon,
  Save,
  CheckCircle2,
  Loader2
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useThemeStore } from '@/store/themeStore'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SchematicForm } from '@/components/SchematicForm';
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function TemplateEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { selectedTemplate, selectTemplate, updateTemplate, loading, error, isDirty, setDirty } = useTemplateStore()
  const { theme } = useThemeStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [inputSchema, setInputSchema] = useState('')
  const [sampleData, setSampleData] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewScale, setPreviewScale] = useState(100)

  // Original values for dirty tracking
  const [originalValues, setOriginalValues] = useState<{
    name: string
    description: string
    content: string
    inputSchema: string
    sampleData: string
  } | null>(null)

  const canEdit = !selectedTemplate?.isSystem

  // View Mode for Sample Data (Form vs Code)
  const [sampleDataViewMode, setSampleDataViewMode] = useState<'form' | 'code'>('form')

  // State for iframe content
  const [srcDoc, setSrcDoc] = useState('')

  const renderPreview = useCallback((templateCode: string, dataStr: string) => {
    let data = {}
    try {
      data = JSON.parse(dataStr)
    } catch (e) {
      // Ignore invalid JSON during streaming
      return
    }

    if (!templateCode.trim()) return;

    // ... existing iframe logic ...
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
              margin: 0; 
              padding: 20px;
              color: #333;
              line-height: 1.5;
            }
            .error { color: #ef4444; background: #fef2f2; padding: 12px; border: 1px solid #fee2e2; border-radius: 6px; font-size: 14px; }
          </style>
        </head>
        <body>
          <div id="root"></div>
          <script type="module">
            import { h, render } from 'https://unpkg.com/preact?module';
            import htm from 'https://unpkg.com/htm?module';
            const html = htm.bind(h);

            try {
              const code = ${JSON.stringify(templateCode)};
              
              // Clean code: remove imports and exports
              const cleanCode = code
                .replace(/import\\s+.*?from\\s+['"].*?['"];?/g, '')
                .replace(/export\\s+default\\s+/g, '')
                .replace(/export\\s+/g, '');

              // Wrap: we need to find the Template function and return it
              const wrappedCode = \`
                \${cleanCode}
                if (typeof Template === 'undefined') {
                  throw new Error('Function "Template" not found in the generated code.');
                }
                return Template;
              \`;

              const TemplateComponent = (new Function('h', 'html', wrappedCode))(h, html);

              const data = ${JSON.stringify(data)};
              render(h(TemplateComponent, { data }), document.getElementById('root'));
            } catch (err) {
              document.getElementById('root').innerHTML = \`
                <div class="error">
                  <strong>Render Error:</strong><br/>
                  \${err.message}
                </div>
              \`;
              console.error('Preview Render Error:', err);
            }
          </script>
        </body>
      </html>
    `

    setSrcDoc(htmlContent)
  }, [])

  useEffect(() => {
    if (id) {
      selectTemplate(id)
    }
  }, [id, selectTemplate])

  useEffect(() => {
    if (selectedTemplate) {
      setName(selectedTemplate.name)
      setDescription(selectedTemplate.description || '')

      const rawContent = selectedTemplate.content
      let initialContent = ''

      if (typeof rawContent === 'string') {
        try {
          const parsed = JSON.parse(rawContent)
          if (parsed && (parsed.template || parsed.html)) {
            initialContent = parsed.template || parsed.html
          } else {
            initialContent = rawContent
          }
        } catch (e) {
          initialContent = rawContent
        }
      } else {
        initialContent = (rawContent as any)?.template || (rawContent as any)?.html || JSON.stringify(rawContent, null, 2)
      }

      setContent(initialContent)
      setInputSchema(JSON.stringify(selectedTemplate.inputSchema, null, 2))
      setSampleData(
        selectedTemplate.sampleData ? JSON.stringify(selectedTemplate.sampleData, null, 2) : '{}'
      )

      // Store original values for dirty tracking
      setOriginalValues({
        name: selectedTemplate.name,
        description: selectedTemplate.description || '',
        content: initialContent,
        inputSchema: JSON.stringify(selectedTemplate.inputSchema, null, 2),
        sampleData: selectedTemplate.sampleData ? JSON.stringify(selectedTemplate.sampleData, null, 2) : '{}',
      })

      renderPreview(initialContent, selectedTemplate.sampleData ? JSON.stringify(selectedTemplate.sampleData) : '{}')
    }
  }, [selectedTemplate, renderPreview])

  // Track dirty state - only runs when content changes, not when isDirty from store changes
  useEffect(() => {
    if (!originalValues) return

    const hasChanges =
      name !== originalValues.name ||
      description !== originalValues.description ||
      content !== originalValues.content ||
      inputSchema !== originalValues.inputSchema ||
      sampleData !== originalValues.sampleData

    setDirty(hasChanges)
  }, [name, description, content, inputSchema, sampleData, originalValues, setDirty])
  useEffect(() => {
    if (!selectedTemplate) return
    const timer = setTimeout(() => {
      renderPreview(content, sampleData)
    }, 500)
    return () => clearTimeout(timer)
  }, [content, sampleData, selectedTemplate, renderPreview])

  const handleRefreshPreview = () => {
    renderPreview(content, sampleData)
  }

  const handleSave = async () => {
    if (!id || !selectedTemplate) return
    setSaving(true)
    try {
      let parsedSchema: Record<string, unknown> = {}
      let parsedSampleData: Record<string, unknown> = {}

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

      // Update originalValues BEFORE API call to prevent race condition
      // This ensures the dirty check effect sees hasChanges: false when isDirty is set to false
      setOriginalValues({
        name,
        description,
        content,
        inputSchema,
        sampleData,
      })

      await updateTemplate(id, {
        name,
        description,
        content: { template: content, type: 'preact-htm' },
        inputSchema: parsedSchema,
        sampleData: parsedSampleData,
      })
    } catch (error) {
      console.error('Failed to save template:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateTemplate = (update: {
    template: string;
    inputSchema: Record<string, unknown>;
    sampleData: Record<string, unknown>;
    description: string;
  }) => {
    if (update.template) setContent(update.template)
    if (update.inputSchema && Object.keys(update.inputSchema).length > 0) setInputSchema(JSON.stringify(update.inputSchema, null, 2))
    if (update.sampleData && Object.keys(update.sampleData).length > 0) setSampleData(JSON.stringify(update.sampleData, null, 2))
    if (update.description && !description) setDescription(update.description)
  }

  const handleSavePreviousValues = () => {
    return {
      template: content,
      inputSchema: inputSchema ? JSON.parse(inputSchema) : {},
      sampleData: sampleData ? JSON.parse(sampleData) : {},
      description: description,
    }
  }

  const handleUndoTemplate = (previousValues: {
    template: string;
    inputSchema: Record<string, unknown>;
    sampleData: Record<string, unknown>;
    description: string;
  }) => {
    setContent(previousValues.template)
    setInputSchema(JSON.stringify(previousValues.inputSchema, null, 2))
    setSampleData(JSON.stringify(previousValues.sampleData, null, 2))
    setDescription(previousValues.description)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
          <p className="text-muted-foreground text-sm">Loading template...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 max-w-md">
          <p className="text-destructive text-center">{error}</p>
          <button onClick={() => navigate('/templates')} className="mt-4 w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors">Back to Templates</button>
        </div>
      </div>
    )
  }

  if (!selectedTemplate) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">Template not found</p>
          <button onClick={() => navigate('/templates')} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">Back to Templates</button>
        </div>
      </div>
    )
  }

  const saveState = saving ? 'saving' : isDirty ? 'dirty' : 'clean'

  const saveLabel = saveState === 'clean' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save'
  const saveBadgeText = saveState === 'clean' ? 'Synced' : saveState === 'saving' ? 'Syncing' : 'Pending'
  const saveBadgeTone =
    saveState === 'clean'
      ? '!bg-emerald-50 !text-emerald-700 !border-emerald-300 dark:!bg-emerald-900 dark:!text-emerald-100 dark:!border-emerald-500'
      : saveState === 'saving'
        ? '!bg-blue-50 !text-blue-700 !border-blue-300 dark:!bg-blue-900 dark:!text-blue-100 dark:!border-blue-500'
        : '!bg-amber-50 !text-amber-700 !border-amber-300 dark:!bg-amber-900 dark:!text-amber-100 dark:!border-amber-500'

  const saveButtonClasses = cn(
    'gap-2 min-w-0 transition-all duration-200',
    saveState === 'clean' && 'border-emerald-200 dark:border-emerald-700',
    saveState === 'dirty' && 'border-gray-300 dark:border-gray-600',
    saveState === 'saving' && 'border-blue-300 dark:border-blue-700'
  )

  const saveIcon =
    saveState === 'clean'
      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      : saveState === 'saving'
        ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        : <Save className="h-4 w-4" />

  return (
    <div className="h-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top Bar - App Title Bar */}
      <header className="min-h-[56px] border-b bg-background flex flex-nowrap items-center px-4 gap-3 py-0 shrink-0">
        <button
          onClick={() => navigate('/templates')}
          className="p-2 hover:bg-accent rounded-lg transition-colors group shrink-0"
          aria-label="Back to templates"
        >
          <ArrowLeftIcon className="w-5 h-5 text-muted-foreground group-hover:text-foreground" />
        </button>

        <div className="flex items-center gap-3 min-w-0 flex-1">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-primary rounded px-2 py-1 min-w-0 max-w-[300px]"
            disabled={selectedTemplate.isSystem}
          />
          <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-full shrink-0">v{selectedTemplate.version}</span>
          {selectedTemplate.isSystem && <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs font-medium rounded-full shrink-0">System</span>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            onClick={handleSave}
            disabled={!canEdit || saving || saveState === 'clean'}
            variant="outline"
            className={saveButtonClasses}
            size="sm"
            title={
              saveState === 'dirty'
                ? 'Changes pending sync'
                : saveState === 'saving'
                  ? 'Syncing now…'
                  : 'No pending edits'
            }
          >
            {saveIcon}
            <span className="hidden xl:inline">{saveLabel}</span>
            <span
              className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded border ml-0 xl:ml-1',
                saveBadgeTone,
                'hidden sm:inline-block'
              )}
            >
              {saveBadgeText}
            </span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden bg-secondary/10">

        {/* Left Panel: Data & Schema Configuration */}
        <aside className="w-[420px] flex flex-col border-r border-border bg-card z-10 shrink-0">
           <Tabs defaultValue="data" className="flex-1 flex flex-col h-full w-full">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/50 backdrop-blur-sm shrink-0">
                <TabsList className="bg-muted/50 p-1 rounded-lg h-8">
                  <TabsTrigger value="data" className="text-xs px-3 h-6 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground">Data</TabsTrigger>
                  <TabsTrigger value="schema" className="text-xs px-3 h-6 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground">Schema</TabsTrigger>
                </TabsList>

                {/* Form/Code toggle - only visible when Sample Data tab is active */}
                <div className="flex gap-1 bg-muted/30 p-0.5 rounded-md">
                  <button
                    onClick={() => setSampleDataViewMode('form')}
                    className={`p-1.5 rounded-sm transition-all ${sampleDataViewMode === 'form' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Form View"
                  >
                    <LayoutListIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setSampleDataViewMode('code')}
                    className={`p-1.5 rounded-sm transition-all ${sampleDataViewMode === 'code' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Code View"
                  >
                    <Code2Icon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <TabsContent value="data" className="flex-1 min-h-0 flex flex-col m-0 p-0 outline-none data-[state=inactive]:hidden" style={{ width: '100%' }}>
                {/* Data Editor Area */}
                <div className="flex-1 overflow-auto bg-background w-full">
                  {sampleDataViewMode === 'form' ? (
                    <div className="p-4 w-full">
                      <SchematicForm
                        className="w-full"
                        schema={(() => { try { return JSON.parse(inputSchema); } catch (e) { return {}; } })()}
                        data={(() => { try { return JSON.parse(sampleData); } catch (e) { return {}; } })()}
                        onChange={(newData) => setSampleData(JSON.stringify(newData, null, 2))}
                      />
                    </div>
                  ) : (
                    <Editor
                      height="100%"
                      defaultLanguage="json"
                      value={sampleData}
                      onChange={(val) => setSampleData(val || '')}
                      theme={theme === 'dark' ? 'vs-dark' : 'light'}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        tabSize: 2,
                        padding: { top: 12, bottom: 12 },
                      }}
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="schema" className="flex-1 min-h-0 flex flex-col m-0 p-0 outline-none data-[state=inactive]:hidden" style={{ width: '100%' }}>
                <div className="flex-1 overflow-hidden relative bg-background w-full">
                  <div className="absolute top-2 right-4 z-10">
                    <span className="px-2 py-1 bg-muted/80 backdrop-blur text-muted-foreground text-[10px] uppercase font-bold rounded border border-border">View Only</span>
                  </div>
                  <Editor
                    height="100%"
                    defaultLanguage="json"
                    value={inputSchema}
                    theme={theme === 'dark' ? 'vs-dark' : 'light'}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      padding: { top: 12, bottom: 12 },
                      renderLineHighlight: 'none',
                    }}
                  />
                </div>
              </TabsContent>
            </Tabs>
        </aside>

        {/* Middle Panel: Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-secondary/30 relative">
          {/* Preview Header (Floating) */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 bg-background/80 backdrop-blur-md border border-border/50 rounded-full shadow-sm">
            <div className="flex items-center gap-2">
              <EyeIcon className="w-3.5 h-3.5 text-green-500" />
              <span className="text-xs font-medium text-foreground mr-2">Preview</span>
            </div>
            <div className="w-px h-3 bg-border"></div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPreviewScale(Math.max(50, previewScale - 10))}
                className="p-1 hover:bg-muted rounded-full transition-colors"
                title="Zoom out"
              >
                <ZoomOutIcon className="w-3 h-3 text-muted-foreground" />
              </button>
              <span className="text-[10px] text-muted-foreground min-w-[2.5rem] text-center tabular-nums">{previewScale}%</span>
              <button
                onClick={() => setPreviewScale(Math.min(150, previewScale + 10))}
                className="p-1 hover:bg-muted rounded-full transition-colors"
                title="Zoom in"
              >
                <ZoomInIcon className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
            <div className="w-px h-3 bg-border mx-1"></div>
            <button
              onClick={handleRefreshPreview}
              className="p-1 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCwIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Preview Content */}
          <div className="flex-1 overflow-hidden p-8 pt-20 flex justify-center">
            <div
              className="bg-white shadow-lg overflow-hidden rounded-xl transition-transform duration-200 ease-out origin-top flex flex-col"
              style={{
                width: '816px', // A4 Width
                height: '100%', // Fill available vertical space
                maxHeight: 'calc(100vh - 160px)', // Constrain to viewport
                transform: `scale(${previewScale / 100})`,
              }}
            >
              <iframe
                srcDoc={srcDoc}
                className="w-full h-full border-none flex-1"
                title="Template Preview"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        </div>

        {/* Right Panel: AI Assistant */}
        <aside className="w-[380px] flex flex-col border-l border-border bg-card z-10 shrink-0">
          <div className="px-4 py-3 border-b border-border bg-background/50 backdrop-blur-sm">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <SparklesIcon className="w-4 h-4 text-purple-500" />
              AI Assistant
            </h2>
          </div>
          <div className="flex-1 overflow-hidden min-h-0 relative w-full">
            <TemplateChat
              onUpdateTemplate={handleUpdateTemplate}
              onSavePreviousValues={handleSavePreviousValues}
              onUndoTemplate={handleUndoTemplate}
              currentTemplate={content}
              currentSchema={(() => { try { return JSON.parse(inputSchema); } catch (e) { return {}; } })()}
              currentSampleData={(() => { try { return JSON.parse(sampleData); } catch (e) { return {}; } })()}
              originalValues={originalValues ? {
                template: originalValues.content,
                inputSchema: originalValues.inputSchema ? JSON.parse(originalValues.inputSchema) : {},
                sampleData: originalValues.sampleData ? JSON.parse(originalValues.sampleData) : {},
                description: originalValues.description,
              } : null}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

