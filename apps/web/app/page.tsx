'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, hasActiveSession } from '@pixchats/core';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.replace('/login');
        return;
      }
      const me = await getCurrentProfile();
      router.replace(me ? '/chats' : '/complete-profile');
    })();
  }, [router]);

  return null;
}
