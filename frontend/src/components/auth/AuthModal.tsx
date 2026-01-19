import React, { useState } from 'react';
import { useAuthProvider } from '../../auth/auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'signin' | 'signup';
  afterSignInUrl?: string;
  afterSignUpUrl?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  defaultMode = 'signin',
  afterSignInUrl,
  afterSignUpUrl,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(defaultMode);
  const authProvider = useAuthProvider();

  const handleModeChange = (newMode: 'signin' | 'signup') => {
    setMode(newMode);
  };

  const handleClose = () => {
    onClose();
    // Reset mode when modal closes
    setMode(defaultMode);
  };

  const SignInComponent = authProvider.SignInComponent;
  const SignUpComponent = authProvider.SignUpComponent;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-center">
            {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(value) => handleModeChange(value as 'signin' | 'signup')}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign In</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="mt-6">
            <div className="space-y-4">
              {authProvider.name === 'clerk' ? (
                <SignInComponent afterSignInUrl={afterSignInUrl} />
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    Sign in is not available with the current auth provider
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Provider:{' '}
                    <code className="bg-muted px-2 py-1 rounded">{authProvider.name}</code>
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="signup" className="mt-6">
            <div className="space-y-4">
              {authProvider.name === 'clerk' ? (
                <SignUpComponent afterSignUpUrl={afterSignUpUrl} />
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    Sign up is not available with the current auth provider
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Provider:{' '}
                    <code className="bg-muted px-2 py-1 rounded">{authProvider.name}</code>
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 pt-4 border-t">
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <span>Using {authProvider.name} authentication</span>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
