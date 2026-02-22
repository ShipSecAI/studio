'use client';

import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import { isValidElement } from 'react';

import { CodeBlock } from './code-block';

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

const statusLabels: Partial<Record<ToolPart['state'], string>> = {
  'input-available': 'Running',
  'input-streaming': 'Pending',
  'output-available': 'Completed',
  'output-denied': 'Denied',
  'output-error': 'Error',
};

const statusIcons: Partial<Record<ToolPart['state'], ReactNode>> = {
  'input-available': <ClockIcon className="size-4 animate-pulse" />,
  'input-streaming': <CircleIcon className="size-4" />,
  'output-available': <CheckCircleIcon className="size-4 text-green-600" />,
  'output-denied': <XCircleIcon className="size-4 text-orange-600" />,
  'output-error': <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart['state']) => (
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
    <div className="max-h-64 overflow-y-auto rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
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
    Array.isArray((output as any).content)
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

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  // Unwrap MCP protocol wrapper for cleaner display
  const { data: unwrapped, isError: mcpError } = unwrapMcpOutput(output);
  const displayError = errorText || (mcpError ? 'Tool execution failed' : undefined);
  const displayOutput = unwrapped;

  let Output = <div>{displayOutput as ReactNode}</div>;

  if (typeof displayOutput === 'object' && !isValidElement(displayOutput)) {
    Output = <CodeBlock code={JSON.stringify(displayOutput, null, 2)} language="json" />;
  } else if (typeof displayOutput === 'string') {
    Output = <CodeBlock code={displayOutput} language="json" />;
  }

  return (
    <div className={cn('space-y-2', className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {displayError ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'max-h-80 overflow-auto rounded-md text-xs [&_table]:w-full',
          displayError ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground',
        )}
      >
        {displayError && <div>{displayError}</div>}
        {Output}
      </div>
    </div>
  );
};
