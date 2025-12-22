import { useCallback, useMemo, useRef, useEffect, useState } from 'react'
import Editor, { OnMount, loader } from '@monaco-editor/react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion'
import { RefreshCw, AlertTriangle } from 'lucide-react'

// Configure Monaco to use CDN
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs' } })

interface Variable {
    name: string
    type: string
}

interface ScriptCodeEditorProps {
    code: string
    onCodeChange: (code: string) => void
    inputVariables: Variable[]
    outputVariables: Variable[]
    theme?: 'vs-dark' | 'light'
}

// Map our types to TypeScript types
function mapTypeToTS(type: string): string {
    switch (type) {
        case 'string': return 'string'
        case 'number': return 'number'
        case 'boolean': return 'boolean'
        case 'list': return 'string[]'
        case 'json': return 'any'
        default: return 'any'
    }
}

// Generate the Input interface
function generateInputInterface(variables: Variable[]): string {
    if (variables.length === 0) {
        return 'interface Input {}'
    }
    const fields = variables.map(v => `  ${v.name}: ${mapTypeToTS(v.type)};`).join('\n')
    return `interface Input {\n${fields}\n}`
}

// Generate the Output interface
function generateOutputInterface(variables: Variable[]): string {
    if (variables.length === 0) {
        return 'interface Output {\n  [key: string]: any;\n}'
    }
    const fields = variables.map(v => `  ${v.name}: ${mapTypeToTS(v.type)};`).join('\n')
    return `interface Output {\n${fields}\n}`
}

// Marker comments for auto-generated types
const TYPES_START_MARKER = '// ===== AUTO-GENERATED TYPES - DO NOT MODIFY ====='
const TYPES_END_MARKER = '// ===== END AUTO-GENERATED TYPES ====='

// Generate the full default code with interfaces
function generateFullCode(inputVars: Variable[], outputVars: Variable[]): string {
    const inputInterface = generateInputInterface(inputVars)
    const outputInterface = generateOutputInterface(outputVars)

    const inputDestructure = inputVars.length > 0
        ? `  const { ${inputVars.map(v => v.name).join(', ')} } = input;\n  `
        : '  '

    const outputReturn = outputVars.length > 0
        ? outputVars.map(v => v.name).join(', ')
        : '/* your output fields */'

    return `${TYPES_START_MARKER}
${inputInterface}

${outputInterface}
${TYPES_END_MARKER}

function script(input: Input): Output {
${inputDestructure}// Your logic here
  
  return { ${outputReturn} };
}
`
}

// Check if code has valid structure
function hasValidStructure(code: string): boolean {
    return code.includes('interface Input') &&
        code.includes('interface Output') &&
        code.includes('function script')
}

// Update interfaces in existing code (between markers)
function updateInterfacesInCode(code: string, inputVars: Variable[], outputVars: Variable[]): string {
    const newInputInterface = generateInputInterface(inputVars)
    const newOutputInterface = generateOutputInterface(outputVars)

    const newTypesSection = `${TYPES_START_MARKER}
${newInputInterface}

${newOutputInterface}
${TYPES_END_MARKER}`

    // Try to replace between markers first
    const markerRegex = new RegExp(
        `${escapeRegex(TYPES_START_MARKER)}[\\s\\S]*?${escapeRegex(TYPES_END_MARKER)}`,
        'g'
    )

    if (markerRegex.test(code)) {
        return code.replace(markerRegex, newTypesSection)
    }

    // Fallback: replace individual interfaces
    let updatedCode = code.replace(
        /interface Input\s*\{[^}]*\}/,
        newInputInterface
    )
    updatedCode = updatedCode.replace(
        /interface Output\s*\{[^}]*\}/,
        newOutputInterface
    )

    return updatedCode
}

// Helper to escape regex special chars
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function ScriptCodeEditor({
    code,
    onCodeChange,
    inputVariables,
    outputVariables,
    theme = 'vs-dark',
}: ScriptCodeEditorProps) {
    const editorRef = useRef<any>(null)
    const monacoRef = useRef<any>(null)
    const [typesOutOfSync, setTypesOutOfSync] = useState(false)

    // Check if types are out of sync when variables change
    useEffect(() => {
        if (!code || !hasValidStructure(code)) {
            setTypesOutOfSync(false)
            return
        }

        const expectedInput = generateInputInterface(inputVariables)
        const expectedOutput = generateOutputInterface(outputVariables)

        // Simple check - see if the expected interfaces are in the code
        const inputMatch = code.includes('interface Input')
        const outputMatch = code.includes('interface Output')

        if (!inputMatch || !outputMatch) {
            setTypesOutOfSync(true)
            return
        }

        // More precise check
        const currentInputMatch = code.match(/interface Input\s*\{[^}]*\}/)
        const currentOutputMatch = code.match(/interface Output\s*\{[^}]*\}/)

        const currentInput = currentInputMatch ? currentInputMatch[0].replace(/\s+/g, '') : ''
        const currentOutput = currentOutputMatch ? currentOutputMatch[0].replace(/\s+/g, '') : ''
        const expectedInputNorm = expectedInput.replace(/\s+/g, '')
        const expectedOutputNorm = expectedOutput.replace(/\s+/g, '')

        setTypesOutOfSync(currentInput !== expectedInputNorm || currentOutput !== expectedOutputNorm)
    }, [code, inputVariables, outputVariables])

    // Generate default code
    const defaultCode = useMemo(() => {
        return generateFullCode(inputVariables, outputVariables)
    }, [inputVariables, outputVariables])

    // Initialize code if empty or has old format
    useEffect(() => {
        if (!code || code.trim() === '' || !hasValidStructure(code)) {
            onCodeChange(defaultCode)
        }
    }, []) // Only on mount

    const handleEditorMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor
        monacoRef.current = monaco

        // Configure TypeScript defaults
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ESNext,
            module: monaco.languages.typescript.ModuleKind.ESNext,
            allowNonTsExtensions: true,
            lib: ['esnext'],
            strict: true,
            noImplicitAny: false,
        })

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ESNext,
            module: monaco.languages.typescript.ModuleKind.ESNext,
            allowNonTsExtensions: true,
            lib: ['esnext'],
        })
    }, [])

    const handleChange = useCallback((value: string | undefined) => {
        onCodeChange(value ?? '')
    }, [onCodeChange])

    // Sync types - update interfaces in code
    const handleSyncTypes = useCallback(() => {
        const updatedCode = updateInterfacesInCode(code, inputVariables, outputVariables)
        onCodeChange(updatedCode)
        setTypesOutOfSync(false)
    }, [code, inputVariables, outputVariables, onCodeChange])

    // Reset to default
    const handleReset = useCallback(() => {
        onCodeChange(defaultCode)
        setTypesOutOfSync(false)
    }, [defaultCode, onCodeChange])

    return (
        <div className="space-y-3">
            {/* Header with actions */}
            <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Script Code</Label>
                <div className="flex items-center gap-2">
                    {typesOutOfSync && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleSyncTypes}
                            className="h-7 text-xs gap-1 text-amber-600 border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                        >
                            <RefreshCw className="h-3 w-3" />
                            Sync Types
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="h-7 text-xs"
                    >
                        Reset
                    </Button>
                </div>
            </div>

            {/* Warning if types out of sync */}
            {typesOutOfSync && (
                <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Type interfaces don't match your variable definitions. Click "Sync Types" to update.</span>
                </div>
            )}

            {/* Monaco Editor */}
            <div className="rounded-md border overflow-hidden">
                <Editor
                    height="280px"
                    language="typescript"
                    value={code}
                    onChange={handleChange}
                    onMount={handleEditorMount}
                    theme={theme}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        tabSize: 2,
                        wordWrap: 'off',
                        padding: { top: 8, bottom: 8 },
                        scrollbar: {
                            verticalScrollbarSize: 8,
                            horizontalScrollbarSize: 8,
                        },
                    }}
                />
            </div>

            {/* Documentation */}
            <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="docs" className="border rounded-md">
                    <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
                        📚 Documentation
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                        <div className="space-y-3 text-xs">
                            <div>
                                <h4 className="font-semibold mb-1">Structure</h4>
                                <p className="text-muted-foreground">
                                    Your code must include <code className="bg-muted px-1 rounded">Input</code> and
                                    <code className="bg-muted px-1 rounded">Output</code> interfaces, and a
                                    <code className="bg-muted px-1 rounded">script</code> function.
                                    When you change variables, click "Sync Types" to update the interfaces.
                                </p>
                            </div>

                            <div>
                                <h4 className="font-semibold mb-1">Example</h4>
                                <pre className="bg-muted rounded p-2 overflow-x-auto text-[11px]">
                                    {`interface Input {
  x: number;
  y: number;
}

interface Output {
  sum: number;
  product: number;
}

function script(input: Input): Output {
  const { x, y } = input;
  return { 
    sum: x + y, 
    product: x * y 
  };
}`}
                                </pre>
                            </div>

                            <div>
                                <h4 className="font-semibold mb-1">External Packages</h4>
                                <p className="text-muted-foreground mb-2 text-sm">
                                    Import any npm package directly using URLs from CDNs like <code>esm.sh</code> or <code>unpkg.com</code>:
                                </p>
                                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto text-muted-foreground mb-3">
                                    {`import _ from 'https://esm.sh/lodash';
import validator from 'https://esm.sh/validator';

export async function script(input: Input): Promise<Output> {
  const result = _.chunk([1, 2, 3], 2);
  const isValid = validator.isEmail(input.email);
  return { result, isValid };
}`}
                                </pre>
                            </div>

                            <div>
                                <h4 className="font-semibold mb-1">Available APIs</h4>
                                <ul className="text-muted-foreground list-disc list-inside space-y-1">
                                    <li><code className="text-foreground">fetch(url, options)</code> - HTTP requests</li>
                                    <li><code className="text-foreground">async/await</code> - Async/Promise support</li>
                                    <li><code className="text-foreground">console.log()</code> - Captured in logs</li>
                                    <li>Full Node.js/Bun Standard Library</li>
                                </ul>
                            </div>

                            <div>
                                <h4 className="font-semibold mb-1">Sandbox Info</h4>
                                <p className="text-muted-foreground">
                                    Code runs in a secure Docker container (Bun runtime) with 256MB RAM and 0.5 CPU.
                                    Execution is capped at 30 seconds.
                                </p>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    )
}
