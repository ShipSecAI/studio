import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { SearchableSelectionList } from './ScheduleDialogShared';

export function CloudFirstScanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: orgConnections = [], isLoading } = useIntegrationConnections();
  const [accountSearch, setAccountSearch] = useState('');

  const awsConnections = useMemo(
    () => orgConnections.filter((c) => c.provider === 'aws'),
    [orgConnections],
  );

  const filteredConnections = useMemo(() => {
    if (!accountSearch.trim()) return awsConnections;
    const q = accountSearch.toLowerCase();
    return awsConnections.filter(
      (c) => (c.displayName ?? '').toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );
  }, [awsConnections, accountSearch]);

  const handleSelect = (connectionId: string) => {
    onClose();
    navigate(`/cloud/accounts?scanConnectionId=${encodeURIComponent(connectionId)}`);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select AWS Account</DialogTitle>
          <DialogDescription>
            Pick an AWS account to run your first cloud security scan on
          </DialogDescription>
        </DialogHeader>

        <SearchableSelectionList
          items={filteredConnections}
          isLoading={isLoading}
          search={accountSearch}
          onSearchChange={setAccountSearch}
          searchPlaceholder="Search accounts..."
          emptyMessage="No AWS accounts found"
          showSearch={awsConnections.length > 3}
          getKey={(conn) => conn.id}
          renderItem={(conn) => (
            <button
              onClick={() => handleSelect(conn.id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
            >
              <img src="/icons/aws.svg" alt="AWS" className="h-4 w-4 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {conn.displayName || 'AWS Account'}
                </div>
                <div className="text-xs text-muted-foreground truncate">Connected</div>
              </div>
            </button>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
