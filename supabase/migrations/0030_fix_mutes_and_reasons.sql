-- ============================================================================
-- Миграция 0030: Исправление таблицы chat_mutes, хранение причин бана/заморозки
-- и комментариев модератора для отображения пользователю
-- ============================================================================

-- 1. Дополняем таблицу profiles полями для причины бана, заморозки и комментария модератора
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ban_reason TEXT,
  ADD COLUMN IF NOT EXISTS frozen_reason TEXT,
  ADD COLUMN IF NOT EXISTS moderator_comment TEXT;

-- 2. Дополняем существующую таблицу chat_mutes (созданную в 0023) полями модераторского мута
ALTER TABLE public.chat_mutes
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS moderator_comment TEXT,
  ADD COLUMN IF NOT EXISTS muted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_penalty BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Разрешаем модераторам и администраторам управлять мутами в чатах
DROP POLICY IF EXISTS "chat_mutes_admin_manage" ON public.chat_mutes;
CREATE POLICY "chat_mutes_admin_manage" ON public.chat_mutes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'developer', 'moderator')
    )
  );
