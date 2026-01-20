import { useState, useEffect } from 'react';
import { KeyRound, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  fetchSecrets,
  type SecretSummary,
  getSecretLabel,
  getSecretDescription,
} from '@/api/secrets';
import { LeanSelect, type SelectOption } from './LeanSelect';

interface SecretSelectProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onRefresh?: () => void;
  clearable?: boolean;
}

/**
 * SecretSelect - A specialized version of LeanSelect for picking secrets.
 */
export function SecretSelect({
  value,
  onChange,
  placeholder = 'Select a secret...',
  disabled = false,
  className,
  onRefresh,
  clearable = true,
}: SecretSelectProps) {
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

  useEffect(() => {
    loadSecrets();
  }, []);

  const options: SelectOption[] = secrets.map((s) => ({
    label: getSecretLabel(s),
    value: s.id,
    description: getSecretDescription(s),
    icon: <KeyRound className="h-3.5 w-3.5" />,
  }));

  const activeSecret = secrets.find((s) => s.id === value || s.name === value);

  // Determine the display label for when the value isn't matched exactly as an option ID
  const selectedLabel = activeSecret
    ? getSecretLabel(activeSecret)
    : value && !loading
      ? /^[0-9a-f]{8}-/i.test(value)
        ? 'Missing Secret'
        : value // Legacy name-based secret reference
      : undefined;

  const handleRefresh = async () => {
    await loadSecrets();
    onRefresh?.();
  };

  const actionButton = (
    <button
      type="button"
      onClick={() => navigate('/secrets')}
      disabled={disabled}
      className={cn(
        'p-2 text-muted-foreground border rounded-md bg-background/50 backdrop-blur-sm',
        'hover:bg-muted/40 hover:text-primary transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      title="Manage secrets in store"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <LeanSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      loading={loading}
      onRefresh={handleRefresh}
      actionButton={actionButton}
      icon={<KeyRound className="h-3.5 w-3.5" />}
      emptyMessage="No secrets found in store"
      clearable={clearable}
      selectedLabel={selectedLabel}
    />
  );
}
