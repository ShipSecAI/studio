import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Cloud } from 'lucide-react';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';

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

        <div className="space-y-3 py-2">
          {awsConnections.length > 3 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto space-y-1">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : filteredConnections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No AWS accounts found
              </p>
            ) : (
              filteredConnections.map((conn) => (
                <button
                  key={conn.id}
                  onClick={() => handleSelect(conn.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
                >
                  <Cloud className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {conn.displayName || 'AWS Account'}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">Connected</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
