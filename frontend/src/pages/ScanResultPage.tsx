import { Navigate, useParams } from 'react-router-dom';

export function ScanResultPage() {
  const { id } = useParams<{ id: string }>();
  const scanTarget = id ? `/github/scans?scan=${encodeURIComponent(id)}` : '/github/scans';

  return <Navigate to={scanTarget} replace />;
}
