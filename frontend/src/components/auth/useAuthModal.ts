import { useState } from 'react';

// Hook to manage auth modal state
export function useAuthModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  const openSignIn = () => {
    setMode('signin');
    setIsOpen(true);
  };

  const openSignUp = () => {
    setMode('signup');
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
  };

  return {
    isOpen,
    mode,
    openSignIn,
    openSignUp,
    close,
  };
}
