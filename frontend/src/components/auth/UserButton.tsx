import React from 'react';
import { useAuthProvider } from '../../auth/auth-context';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Shield, User, LogOut, Settings } from 'lucide-react';

interface UserButtonProps {
  afterSignOutUrl?: string;
  appearance?: any;
  showUserInfo?: boolean;
  className?: string;
  sidebarCollapsed?: boolean;
}

export const UserButton: React.FC<UserButtonProps> = ({
  afterSignOutUrl = '/',
  appearance,
  showUserInfo = true,
  className = '',
  sidebarCollapsed = false,
}) => {
  const authProvider = useAuthProvider();
  const { user, isAuthenticated, isLoading } = authProvider.context;

  // Handle loading state
  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled className={className}>
        <div className="animate-pulse flex items-center space-x-2">
          <div className="w-6 h-6 bg-muted rounded-full"></div>
          <div className="w-16 h-4 bg-muted rounded"></div>
        </div>
      </Button>
    );
  }

  // If not authenticated, show sign in button
  if (!isAuthenticated || !user) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={authProvider.signIn}
        className={className}
      >
        <User className="w-4 h-4 mr-2" />
        Sign In
      </Button>
    );
  }

  // Use Clerk's UserButton if available
  if (authProvider.name === 'clerk') {
    const ClerkUserButton = authProvider.UserButtonComponent;
    return (
      <div className={`flex items-center ${className}`}>
        <ClerkUserButton
          afterSignOutUrl={afterSignOutUrl}
          appearance={{
            elements: {
              avatarBox: sidebarCollapsed ? 'w-8 h-8' : 'w-8 h-8',
              userButtonTrigger: sidebarCollapsed ? 'w-8 h-8' : 'w-full',
              ...appearance?.elements,
            },
            ...appearance,
          }}
        />
      </div>
    );
  }

  // Fallback custom user button for other providers
  const userInitials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user.username
    ? user.username.substring(0, 2).toUpperCase()
    : user.email
    ? user.email.substring(0, 2).toUpperCase()
    : 'U';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={`relative h-8 w-8 rounded-full ${className}`}>
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.imageUrl} alt={user.username || user.email} />
            <AvatarFallback>{userInitials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        {showUserInfo && (
          <>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user.firstName && user.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user.username || 'User'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user.email}
                </p>
                {user.organizationName && (
                  <p className="text-xs leading-none text-muted-foreground">
                    {user.organizationName}
                    {user.organizationRole && (
                      <span className="ml-1">• {user.organizationRole}</span>
                    )}
                  </p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem>
          <User className="mr-2 h-4 w-4" />
          <span>Profile</span>
        </DropdownMenuItem>

        <DropdownMenuItem>
          <Settings className="mr-2 h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>

        {user.organizationId && (
          <DropdownMenuItem>
            <Shield className="mr-2 h-4 w-4" />
            <span>Organization</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => authProvider.signOut()}
          className="text-red-600"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          Provider: {authProvider.name}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Compact version for navigation bars
export const UserButtonCompact: React.FC<Omit<UserButtonProps, 'showUserInfo'>> = (props) => {
  return <UserButton {...props} showUserInfo={false} />;
};

// Text-based version for mobile or accessibility
export const UserButtonText: React.FC<{ className?: string }> = ({ className = '' }) => {
  const authProvider = useAuthProvider();
  const { user, isAuthenticated, isLoading } = authProvider.context;

  if (isLoading) {
    return <div className={`animate-pulse w-16 h-4 bg-muted rounded ${className}`}></div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={authProvider.signIn}
        className={className}
      >
        Sign In
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => authProvider.signOut()}
      className={className}
    >
      Sign Out
    </Button>
  );
};