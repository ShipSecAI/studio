import { useState, useEffect } from 'react';
import { ChevronDown, KeyRound, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchSecrets,
  type SecretSummary,
  getSecretLabel,
  getSecretDescription,
} from '@/api/secrets';

interface SecretSelectProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  allowManualEntry?: boolean;
}

export function SecretSelect({
  value,
  onChange,
  placeholder = 'Select a secret...',
  disabled = false,
  className,
  allowManualEntry = true,
}: SecretSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState(value || '');

  // Fetch secrets when component opens
  useEffect(() => {
    if (isOpen && secrets.length === 0) {
      loadSecrets();
    }
  }, [isOpen]);

  // Sync manual value with prop
  useEffect(() => {
    setManualValue(value || '');
  }, [value]);

  // Determine if current value is a manual entry (UUID format)
  useEffect(() => {
    if (value && !secrets.find((s) => s.id === value)) {
      setManualMode(true);
    } else {
      setManualMode(false);
    }
  }, [value, secrets]);

  const loadSecrets = async () => {
    setLoading(true);
    try {
      const fetchedSecrets = await fetchSecrets();
      setSecrets(fetchedSecrets);
    } catch (error) {
      console.error('Failed to load secrets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (secretId: string) => {
    onChange(secretId);
    setIsOpen(false);
    setManualMode(false);
  };

  const handleManualChange = (newValue: string) => {
    setManualValue(newValue);
    onChange(newValue);
  };

  const toggleMode = () => {
    if (manualMode) {
      // Switching to dropdown mode
      setManualMode(false);
      // Clear the manual value
      onChange('');
      setManualValue('');
    } else {
      // Switching to manual mode
      setManualMode(true);
      setIsOpen(false);
    }
  };

  const selectedSecret = secrets.find((s) => s.id === value);

  return (
    <div className="relative">
      {/* Input Display */}
      <div className="flex items-center gap-1">
        {manualMode ? (
          // Manual input field
          <input
            type="text"
            value={manualValue}
            onChange={(e) => handleManualChange(e.target.value)}
            placeholder="Enter secret UUID..."
            disabled={disabled}
            className={cn(
              'flex-1 px-3 py-2 text-sm border rounded-md bg-background',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
              disabled && 'opacity-50 cursor-not-allowed',
              className,
            )}
          />
        ) : (
          // Dropdown selector
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className={cn(
              'flex-1 px-3 py-2 text-sm border rounded-md bg-background',
              'flex items-center justify-between gap-2',
              'hover:bg-muted/50 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
              disabled && 'opacity-50 cursor-not-allowed',
              className,
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="truncate">
                {selectedSecret ? getSecretLabel(selectedSecret) : placeholder}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </button>
        )}

        {/* Mode toggle button */}
        {allowManualEntry && (
          <button
            type="button"
            onClick={toggleMode}
            disabled={disabled}
            className={cn(
              'p-2 text-sm border rounded-md bg-background hover:bg-muted/50 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
            title={manualMode ? 'Switch to dropdown selection' : 'Switch to manual entry'}
          >
            {manualMode ? <KeyRound className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Dropdown */}
      {!manualMode && isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
          {loading ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              Loading secrets...
            </div>
          ) : secrets.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              No secrets found
            </div>
          ) : (
            <div className="py-1">
              {secrets.map((secret) => (
                <button
                  key={secret.id}
                  type="button"
                  onClick={() => handleSelect(secret.id)}
                  className={cn(
                    'w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors',
                    'flex flex-col gap-1',
                    value === secret.id && 'bg-muted',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium">{getSecretLabel(secret)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground ml-6">
                    {getSecretDescription(secret)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {!manualMode && isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
}
