import { KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import { getSecretLabel } from '@/api/secrets';
import type { ParametersDisplayProps } from './types';

/**
 * Parameters Display - Shows required and select parameters on the node
 */
export function ParametersDisplay({
  componentParameters,
  requiredParams,
  nodeParameters,
  position = 'bottom',
}: ParametersDisplayProps) {
  const { data: secrets = [] } = useSecrets();

  // Show required parameters and important select parameters (like mode)
  // Exclude nested parameters (those with visibleWhen) like schemaType
  const selectParams = componentParameters.filter(
    (param) =>
      (param.type === 'select' || param.type === 'secret') && !param.required && !param.visibleWhen,
  );
  const paramsToShow = [...requiredParams, ...selectParams];

  if (paramsToShow.length === 0) return null;

  return (
    <div
      className={cn(
        position === 'top'
          ? 'pb-2 mb-2 border-b border-border/50'
          : 'pt-2 border-t border-border/50',
      )}
    >
      <div className="space-y-1">
        {paramsToShow.map((param) => {
          const value = nodeParameters?.[param.id];
          const effectiveValue = value !== undefined ? value : param.default;
          const hasValue =
            effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== '';
          const isDefault = value === undefined && param.default !== undefined;

          // For select/secret parameters, show the label instead of value
          let displayValue = hasValue ? effectiveValue : '';
          const isSecret = param.type === 'secret';

          if (param.type === 'select' && hasValue && param.options) {
            const option = param.options.find((opt: any) => opt.value === effectiveValue);
            displayValue = option?.label || effectiveValue;
          } else if (isSecret && hasValue) {
            const secret = secrets.find(
              (s) => s.id === effectiveValue || s.name === effectiveValue,
            );
            displayValue = secret ? getSecretLabel(secret) : effectiveValue;
          }

          return (
            <div
              key={`param-${param.id}`}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-muted-foreground font-medium truncate">{param.label}</span>
              <div className="flex items-center gap-1">
                {hasValue ? (
                  <span
                    className={cn(
                      'font-mono px-1 py-0.5 rounded text-[10px] truncate max-w-[80px]',
                      isDefault
                        ? 'text-muted-foreground bg-muted/50 italic'
                        : isSecret
                          ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 font-semibold flex items-center gap-1'
                          : param.type === 'select'
                            ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 font-semibold'
                            : 'text-foreground bg-muted',
                    )}
                    title={isDefault ? `Default: ${String(displayValue)}` : String(displayValue)}
                  >
                    {isSecret && <KeyRound className="h-2.5 w-2.5" />}
                    {String(displayValue)}
                  </span>
                ) : param.required ? (
                  <span className="text-red-500 text-[10px]">*required</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
