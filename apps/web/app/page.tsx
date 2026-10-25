'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, hasActiveSession } from '@pixchats/core';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

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

  return (
    <main className="page-center">
      <img src={`${BASE_PATH}/logo/icon.png`} alt="PixChats" className="splash-logo" />
    </main>
  );
}
