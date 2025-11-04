import React from 'react';
import { useAuthProvider } from '../../auth/auth-context';
import { Button } from '../ui/button';
import { Building2 } from 'lucide-react';

interface OrganizationSwitcherProps {
  appearance?: any;
  className?: string;
}

/**
 * Organization Switcher Component
 * 
 * For Clerk: Uses Clerk's OrganizationSwitcher component
 * For other providers: Shows organization info or placeholder
 */
export const OrganizationSwitcher: React.FC<OrganizationSwitcherProps> = ({
  appearance,
  className = '',
}) => {
  const authProvider = useAuthProvider();
  const { user, isAuthenticated } = authProvider.context;

  // Use Clerk's OrganizationSwitcher if available
  if (authProvider.name === 'clerk' && authProvider.OrganizationSwitcherComponent) {
    const ClerkOrgSwitcher = authProvider.OrganizationSwitcherComponent;
    return (
      <div className={className}>
        <ClerkOrgSwitcher appearance={appearance} />
      </div>
    );
  }

  // Fallback for other providers or when not authenticated
  if (!isAuthenticated || !user) {
    return null;
  }

  // Show organization name if available
  if (user.organizationName) {
    return (
      <Button variant="outline" size="sm" className={className} disabled>
        <Building2 className="w-4 h-4 mr-2" />
        <span className="truncate max-w-[150px]">{user.organizationName}</span>
      </Button>
    );
  }

  // Show workspace indicator
  if (user.organizationId?.startsWith('workspace-')) {
    return (
      <Button variant="outline" size="sm" className={className} disabled>
        <Building2 className="w-4 h-4 mr-2" />
        <span>My Workspace</span>
      </Button>
    );
  }

  return null;
};

