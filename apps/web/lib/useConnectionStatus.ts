'use client';

import { useState, useEffect } from 'react';
import { getSupabaseClient } from '@pixchats/core';

export type ConnectionStatus = 'online' | 'connecting' | 'offline';

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('online');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setStatus('connecting');
      setTimeout(() => {
        if (navigator.onLine) setStatus('online');
      }, 1200);
    };

    const handleOffline = () => {
      setStatus('offline');
    };

    if (!navigator.onLine) {
      setStatus('offline');
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}
