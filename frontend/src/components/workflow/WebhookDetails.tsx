
import { useState } from 'react';
import { Copy, Check, Terminal, FileCode, Braces, Code2, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { codeSnippets } from './code-snippets';

interface WebhookDetailsProps {
    url: string;
    payload: any;
    triggerLabel?: string;
    className?: string;
    apiKey?: string | null;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function WebhookDetails({ url, payload, triggerLabel = "View Integration Code", className, apiKey, open, onOpenChange }: WebhookDetailsProps) {
    const [copied, setCopied] = useState(false);
    const navigate = useNavigate();
    const safePayload = JSON.stringify(payload, null, 2);
    const safePayloadSingleLine = JSON.stringify(payload).replace(/'/g, "\\'");
    const apiKeyForSnippets = apiKey || '<YOUR_API_KEY>';

    // Format payload for Python - use JSON string that gets parsed
    const pythonPayloadJson = JSON.stringify(payload).replace(/'/g, "\\'");

    // Format payload for Go - convert JSON to Go map literal format
    const goPayloadLines = safePayload
        .split('\n')
        .slice(1, -1) // Remove outer braces
        .map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed === '{' || trimmed === '}') return '';
            // Convert JSON key: value to Go format
            const match = trimmed.match(/^"([^"]+)":\s*(.+),?$/);
            if (match) {
                const [, key, value] = match;
                return `"${key}": ${value},`;
            }
            return trimmed;
        })
        .filter(Boolean)
        .join('\n        ');

    // Replace placeholders in snippet templates
    const replacePlaceholders = (template: string): string => {
        return template
            .replace(/{{URL}}/g, url)
            .replace(/{{API_KEY}}/g, apiKeyForSnippets)
            .replace(/{{PAYLOAD}}/g, safePayload)
            .replace(/{{PAYLOAD_SINGLE_LINE}}/g, safePayloadSingleLine)
            .replace(/{{PAYLOAD_JSON}}/g, pythonPayloadJson)
            .replace(/{{GO_PAYLOAD}}/g, goPayloadLines);
    };

    const snippets = {
        curl: replacePlaceholders(codeSnippets.curl),
        typescript: replacePlaceholders(codeSnippets.typescript),
        python: replacePlaceholders(codeSnippets.python),
        go: replacePlaceholders(codeSnippets.go),
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-2", className)}>
                    <Code2 className="h-4 w-4" />
                    {triggerLabel}
                </Button>
            </DialogTrigger>
            <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[800px] sm:h-[600px]">
                <DialogHeader className="px-6 py-6 border-b relative">
                    <DialogTitle>Invoke Workflow</DialogTitle>
                    <DialogDescription>
                        Use the code snippets below to trigger this workflow from your application.
                        {!apiKey && (
                            <span className="block mt-1">
                                Replace <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">&lt;YOUR_API_KEY&gt;</code> with your actual API key.
                            </span>
                        )}
                    </DialogDescription>
                    {/* Manage API Keys button - bottom right of header */}
                    <div className="absolute bottom-4 right-6">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                            onClick={() => {
                                navigate('/api-keys');
                                onOpenChange?.(false);
                            }}
                        >
                            <Key className="h-3 w-3" />
                            Manage API Keys
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 min-h-0 p-6">
                    <Tabs defaultValue="curl" className="flex flex-col h-full w-full">
                        <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0 h-auto">
                            <TabsTrigger
                                value="curl"
                                className="relative h-9 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
                            >
                                <Terminal className="mr-2 h-4 w-4" />
                                cURL
                            </TabsTrigger>
                            <TabsTrigger
                                value="typescript"
                                className="relative h-9 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
                            >
                                <Braces className="mr-2 h-4 w-4" />
                                TypeScript
                            </TabsTrigger>
                            <TabsTrigger
                                value="python"
                                className="relative h-9 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
                            >
                                <FileCode className="mr-2 h-4 w-4" />
                                Python
                            </TabsTrigger>
                            <TabsTrigger
                                value="go"
                                className="relative h-9 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
                            >
                                <Code2 className="mr-2 h-4 w-4" />
                                Go
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex-1 mt-4 relative">
                            {Object.entries(snippets).map(([lang, code]) => (
                                <TabsContent key={lang} value={lang} className="absolute inset-0 m-0 border rounded-md bg-muted/30">
                                    <div className="relative h-full">
                                        <div className="h-full overflow-auto p-4 custom-scrollbar">
                                            <pre className="text-xs font-mono leading-relaxed whitespace-pre">
                                                {code}
                                            </pre>
                                        </div>
                                        {/* Floating copy button - bottom right */}
                                        <div className="absolute bottom-3 right-3">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 text-xs gap-1.5 bg-background shadow-lg border hover:bg-muted"
                                                onClick={() => copyToClipboard(code)}
                                            >
                                                {copied ? (
                                                    <>
                                                        <Check className="h-3 w-3 text-green-500" />
                                                        <span className="text-green-600">Copied</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy className="h-3 w-3" />
                                                        <span>Copy</span>
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </TabsContent>
                            ))}
                        </div>
                    </Tabs>
                </div>
            </DialogContent>
        </Dialog>
    );
}
