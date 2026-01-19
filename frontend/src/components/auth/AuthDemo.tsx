import React from 'react';
import { useAuth } from '@/auth/auth-context';
import { useAuthModal } from './useAuthModal';
import { UserButton } from './UserButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, User, Key, Mail, Building, Users } from 'lucide-react';

export const AuthDemo: React.FC = () => {
  const { user, token, isAuthenticated, isLoading, error } = useAuth();
  const { openSignIn } = useAuthModal();

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Authentication Demo
          </CardTitle>
          <CardDescription>Loading authentication state...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-4 bg-muted rounded w-5/6"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isAuthenticated) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Authentication Demo
          </CardTitle>
          <CardDescription>Experience the modular authentication system</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 p-4 rounded-lg">
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <User className="w-4 h-4" />
              Current Status: Not Authenticated
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Sign in to test the complete authentication flow including token management, user
              profile, and protected routes.
            </p>
            <Button onClick={openSignIn} className="w-full">
              Sign In with Clerk
            </Button>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium flex items-center gap-2">
              <Key className="w-4 h-4" />
              Features Available After Sign In:
            </h3>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">JWT Token</Badge>
                <span className="text-muted-foreground">Automatic token management</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">User Profile</Badge>
                <span className="text-muted-foreground">Complete user information</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">Organization</Badge>
                <span className="text-muted-foreground">Organization membership & roles</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">Protected Routes</Badge>
                <span className="text-muted-foreground">Automatic route protection</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 p-3 rounded-lg text-destructive text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Authentication Demo
        </CardTitle>
        <CardDescription>Successfully authenticated with modular auth system</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* User Profile Section */}
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <User className="w-4 h-4" />
            User Profile
          </h3>
          <div className="grid gap-3 text-sm">
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-muted-foreground" />
              <div>
                <div className="font-medium">
                  {user?.firstName && user?.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user?.username || 'Unknown User'}
                </div>
                <div className="text-muted-foreground">ID: {user?.id}</div>
              </div>
            </div>

            {user?.email && (
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span>{user.email}</span>
              </div>
            )}

            {user?.imageUrl && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full overflow-hidden">
                  <img
                    src={user.imageUrl}
                    alt="User avatar"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-muted-foreground">Profile picture available</span>
              </div>
            )}
          </div>
        </div>

        {/* Organization Section */}
        {user?.organizationId && (
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <Building className="w-4 h-4" />
              Organization Information
            </h3>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">
                    {user.organizationName || 'Unknown Organization'}
                  </div>
                  <div className="text-muted-foreground">ID: {user.organizationId}</div>
                </div>
              </div>

              {user.organizationRole && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{user.organizationRole}</Badge>
                  <span className="text-muted-foreground">Organization Role</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Token Information */}
        {token && (
          <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <Key className="w-4 h-4" />
              JWT Token Information
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Token</Badge>
                <span className="text-muted-foreground font-mono text-xs">
                  {token.token.substring(0, 20)}...
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">Expires</Badge>
                <span className="text-muted-foreground">
                  {token.expiresAt ? new Date(token.expiresAt).toLocaleString() : 'Unknown'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* User Button Demo */}
        <div className="bg-gray-50 dark:bg-gray-900/20 p-4 rounded-lg">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <User className="w-4 h-4" />
            User Button Component
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            This is the user button that appears in the navigation bar:
          </p>
          <div className="flex justify-center">
            <UserButton />
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 p-3 rounded-lg text-destructive text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
