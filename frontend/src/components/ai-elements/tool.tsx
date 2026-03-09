'use client';

import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
  CopyIcon,
  CheckIcon,
  InfoIcon,
} from 'lucide-react';
import { isValidElement, useState } from 'react';

import { ObjectViewer } from './object-viewer';

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn('group not-prose mb-4 w-full rounded-md border', className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
  | {
      type: DynamicToolUIPart['type'];
      state: DynamicToolUIPart['state'];
      toolName: string;
    }
);

const statusLabels: Record<string, string> = {
  'input-available': 'Running',
  'input-streaming': 'Pending',
  'output-available': 'Completed',
  'output-denied': 'Denied',
  'output-error': 'Error',
};

const statusIcons: Record<string, ReactNode> = {
  'input-available': <ClockIcon className="size-4 animate-pulse" />,
  'input-streaming': <CircleIcon className="size-4" />,
  'output-available': <CheckCircleIcon className="size-4 text-green-600" />,
  'output-denied': <XCircleIcon className="size-4 text-orange-600" />,
  'output-error': <XCircleIcon className="size-4 text-red-600" />,
};

const getStatusBadge = (status: ToolPart['state']) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName = type === 'dynamic-tool' ? toolName : type.split('-').slice(1).join('-');

  return (
    <CollapsibleTrigger
      className={cn('flex w-full items-center justify-between gap-4 p-3', className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolPart['input'];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('space-y-2 overflow-hidden', className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="max-h-64 overflow-y-auto rounded-md bg-muted/30 border p-3">
      <ObjectViewer data={input} />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolPart['output'];
  errorText: ToolPart['errorText'];
};

/**
 * Unwrap MCP protocol wrapper from tool output.
 * MCP returns: { content: [{ type: "text", text: "..." }, ...], isError?: boolean }
 * We extract the inner content for cleaner display.
 */
function unwrapMcpOutput(output: unknown): { data: unknown; isError?: boolean } {
  if (
    output &&
    typeof output === 'object' &&
    'content' in output &&
    Array.isArray((output as { content: unknown }).content)
  ) {
    const mcpResult = output as {
      content: { type: string; text?: string; data?: string; mimeType?: string }[];
      isError?: boolean;
    };
    const parts = mcpResult.content;

    // Single text part — extract and try to parse as JSON
    if (parts.length === 1 && parts[0].type === 'text' && parts[0].text != null) {
      try {
        return { data: JSON.parse(parts[0].text), isError: mcpResult.isError };
      } catch {
        return { data: parts[0].text, isError: mcpResult.isError };
      }
    }

    // Multiple parts — extract text content joined
    if (parts.length > 0) {
      const textParts = parts.filter((p) => p.type === 'text' && p.text != null);
      if (textParts.length > 0) {
        const combined = textParts.map((p) => p.text).join('\n');
        try {
          return { data: JSON.parse(combined), isError: mcpResult.isError };
        } catch {
          return { data: combined, isError: mcpResult.isError };
        }
      }
    }
  }
  return { data: output };
}

function formatToolErrorDetails(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return undefined;
    }
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : undefined;
}

export function extractToolErrorDetails(
  output: unknown,
  errorText?: string,
): { summary?: string; details?: string } {
  const { data: unwrapped, isError: mcpError } = unwrapMcpOutput(output);
  const summary = errorText || (mcpError ? 'Tool execution failed' : undefined);
  const rawDetails = formatToolErrorDetails(unwrapped);

  if (!summary) {
    return { summary, details: undefined };
  }

  if (!rawDetails || rawDetails === summary) {
    return { summary, details: undefined };
  }

  return { summary, details: rawDetails };
}

// Copy button helper
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border/60 hover:bg-muted/60"
      title="Copy to clipboard"
    >
      {copied ? (
        <>
          <CheckIcon className="h-3 w-3 text-emerald-500" />
          <span className="text-emerald-500">Copied</span>
        </>
      ) : (
        <>
          <CopyIcon className="h-3 w-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  // Unwrap MCP protocol wrapper for cleaner display
  const { data: unwrapped } = unwrapMcpOutput(output);
  const { summary: displayError, details: errorDetails } = extractToolErrorDetails(
    output,
    errorText,
  );
  const displayOutput = unwrapped;
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const canShowDevErrorDetails = import.meta.env.DEV && Boolean(errorDetails);

  // Decide how to render
  let renderContent: React.ReactNode;
  let copyText: string | undefined;

  if (displayError) {
    renderContent = (
      <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex items-start gap-2">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-medium text-destructive">Tool Error</p>
            <p className="whitespace-pre-wrap break-words text-xs text-destructive/80">
              {displayError}
            </p>
            {canShowDevErrorDetails && (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowErrorDetails((current) => !current)}
                >
                  <InfoIcon className="h-3.5 w-3.5" />
                  {showErrorDetails ? 'Hide details' : 'Show details'}
                </Button>
                {showErrorDetails && (
                  <pre className="mt-2 overflow-auto rounded border border-destructive/20 bg-background/80 p-2 text-[11px] leading-relaxed text-foreground">
                    {errorDetails}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
    copyText = String(displayError);
  } else if (isValidElement(displayOutput as React.ReactNode)) {
    renderContent = <div className="p-3">{displayOutput as React.ReactNode}</div>;
  } else if (typeof displayOutput === 'string') {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(displayOutput);
      if (typeof parsed === 'object' && parsed !== null) {
        const jsonStr = JSON.stringify(parsed, null, 2);
        copyText = jsonStr;
        renderContent = (
          <div className="p-3">
            <ObjectViewer data={parsed} />
          </div>
        );
      } else {
        copyText = displayOutput;
        renderContent = <div className="p-3 whitespace-pre-wrap text-xs">{displayOutput}</div>;
      }
    } catch {
      copyText = displayOutput;
      if (displayOutput.length <= 300) {
        // Short text — render as clean readable block
        renderContent = <div className="p-3 text-sm leading-relaxed">{displayOutput}</div>;
      } else {
        renderContent = (
          <div className="p-3 whitespace-pre-wrap text-xs font-mono">{displayOutput}</div>
        );
      }
    }
  } else if (typeof displayOutput === 'object' && displayOutput !== null) {
    const jsonStr = JSON.stringify(displayOutput, null, 2);
    copyText = jsonStr;
    renderContent = (
      <div className="p-3">
        <ObjectViewer data={displayOutput as Record<string, unknown>} />
      </div>
    );
  } else if (displayOutput !== undefined && displayOutput !== null) {
    const str = String(displayOutput);
    copyText = str;
    renderContent = <div className="p-3 text-sm">{str}</div>;
  } else {
    return null;
  }

  return (
    <div className={cn('space-y-2', className)} {...props}>
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {displayError ? 'Error' : 'Result'}
        </h4>
        {copyText && !displayError && <CopyButton text={copyText} />}
      </div>
      <div
        className={cn(
          'max-h-80 overflow-auto rounded-md text-xs [&_table]:w-full',
          displayError ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground',
        )}
      >
        {renderContent}
      </div>
    </div>
  );
};
