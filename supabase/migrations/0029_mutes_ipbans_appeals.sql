-- Migration 0029: Chat Mutes, IP Bans, Appeals, and Frozen At timestamp

-- 1. Chat Mutes table
CREATE TABLE IF NOT EXISTS public.chat_mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  muted_until TIMESTAMPTZ,
  reason TEXT,
  muted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chat_mutes_user_chat_key UNIQUE (user_id, chat_id)
);

ALTER TABLE public.chat_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own mutes"
  ON public.chat_mutes FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = muted_by OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'developer', 'moderator')
  ));

CREATE POLICY "Admins and system can insert mutes"
  ON public.chat_mutes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins and system can update mutes"
  ON public.chat_mutes FOR UPDATE
  USING (true);

CREATE POLICY "Admins and system can delete mutes"
  ON public.chat_mutes FOR DELETE
  USING (true);

-- 2. Banned IPs table
CREATE TABLE IF NOT EXISTS public.banned_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL UNIQUE,
  reason TEXT,
  banned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.banned_ips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read banned ips"
  ON public.banned_ips FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'developer', 'moderator')
  ) OR true);

CREATE POLICY "Admins can insert banned ips"
  ON public.banned_ips FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can delete banned ips"
  ON public.banned_ips FOR DELETE
  USING (true);

-- 3. Appeals table (Обжалования наказаний)
CREATE TABLE IF NOT EXISTS public.appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  penalty_type TEXT NOT NULL, -- 'mute', 'freeze', 'ban_account', 'ban_ip'
  chat_id UUID REFERENCES public.chats(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  admin_notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own appeals"
  ON public.appeals FOR SELECT
  USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'developer', 'moderator')
  ));

CREATE POLICY "Users can insert their own appeals"
  ON public.appeals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can update appeals"
  ON public.appeals FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'developer', 'moderator')
  ));

-- 4. Add frozen_at and last_ip columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_ip TEXT;

-- 5. Function to clean up frozen accounts older than 90 days
CREATE OR REPLACE FUNCTION public.cleanup_expired_frozen_accounts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  DELETE FROM public.profiles
  WHERE frozen = true
    AND frozen_at IS NOT NULL
    AND frozen_at < (now() - INTERVAL '90 days');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
