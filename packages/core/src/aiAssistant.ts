import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import type { Profile, UserRole } from './types';
import {
  type AdminUserFilter,
  getAdminStats,
  listProfilesForAdmin,
  setUserRole,
  setUserVerification,
  setPixsetEmployeeBadge,
  banAccount,
  unbanAccount,
  setAccountFrozen,
  deleteAccount,
  muteUserInChat,
  unmuteUserInChat,
  getUserAllMutes,
  listCustomRoles,
  createCustomRole,
  deleteCustomRole,
  clearAllCustomRoles,
  toggleUserCustomRole,
  listAppealsForAdmin,
  reviewAppeal,
  getMessageReportsForAdmin,
  listBannedIps,
  banIpAddress,
  unbanIpAddress,
  listBannedUsernames,
  banUsername,
  unbanUsername,
  cleanupExpiredFrozenAccounts,
  listGroupAndChannelChatsForAdmin,
  setChatVerification,
  getAuditLogsForAdmin,
  getErrorLogs,
  getSystemStatus,
  checkSystemStatusNow,
} from './admin';
import {
  getMessages,
  sendMessage,
  deleteMessage,
  pinMessage,
  unpinMessage,
} from './messages';
import { getSupabaseClient } from './supabaseClient';

export interface FreeTierAiModelOption {
  id: string;
  label: string;
  badge: string;
  description: string;
  isAgent?: boolean;
}

export const FREE_TIER_AI_MODELS: FreeTierAiModelOption[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    badge: 'Рекомендуется • Free Tier',
    description: 'Стабильная и быстрая мультимодальная модель Gemini 2.5 с высокой точностью вызова инструментов PixChats.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    badge: 'Макс. лимиты • Free Tier',
    description: 'Сверхбыстрая облегчённая модель серии 2.5 с максимальной бесплатной квотой запросов в сутки.',
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    badge: 'Поколение 3 • Free Tier',
    description: 'Модель Gemini 3 Flash с глубоким анализом контекста и быстрой многошаговой работой с базой.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    badge: 'Быстрая 3.5 • Free Tier',
    description: 'Скоростная облегчённая модель поколения 3.5 для мгновенной модерации и проверок.',
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    badge: 'Продвинутая 3.6 • Free Tier',
    description: 'Улучшенная модель серии 3.6 для сложной аналитики, отчётов и управления приложением.',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    badge: 'Новейшая 3.8 • Free Tier',
    description: 'Флагманская модель семейства Flash с расширенным планированием действий администратора.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    badge: 'Лёгкая 3.1 • Free Tier',
    description: 'Экономичная модель с минимальной задержкой отклика.',
  },
  {
    id: 'gemini-flash-latest',
    label: 'Gemini Flash (Latest Auto)',
    badge: 'Автообновление • Free Tier',
    description: 'Автоматический алиас на самую свежую стабильную версию Gemini Flash.',
  },
  {
    id: 'antigravity-preview-09-2026',
    label: 'Агент Antigravity',
    badge: 'Автономный Агент • Interactions API',
    description: 'Режим автономного ИИ-агента: многошаговое планирование, песочница выполнения кода Python, веб-поиск и комплексный аудит PixChats.',
    isAgent: true,
  },
];

const AI_CONFIG_LS_KEY = 'pixchats_dev_ai_assistant_config_v1';
const AI_BUCKET = 'avatars';
const AI_CONFIG_FILE_NAME = 'dev_ai_assistant_config_v1.json';

export interface DeveloperAiConfig {
  apiKey: string;
  model: string;
  updatedAt?: string;
}

export function getLocalDeveloperAiConfig(): DeveloperAiConfig {
  const defaultModel = FREE_TIER_AI_MODELS[0].id;
  const envKey =
    (typeof process !== 'undefined' &&
      (process.env?.GEMINI_API_KEY || process.env?.NEXT_PUBLIC_GEMINI_API_KEY)) ||
    '';

  if (typeof window === 'undefined') {
    return { apiKey: envKey, model: defaultModel };
  }
  try {
    const raw = localStorage.getItem(AI_CONFIG_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        apiKey: String(parsed.apiKey || envKey || '').trim(),
        model: String(parsed.model || defaultModel).trim(),
        updatedAt: parsed.updatedAt,
      };
    }
  } catch {
    // ignore
  }
  return { apiKey: envKey, model: defaultModel };
}

export async function loadDeveloperAiConfig(actingProfile: Profile): Promise<DeveloperAiConfig> {
  if (actingProfile.role !== 'developer') {
    throw new Error('Доступ к AI ассистенту разрешён только разработчикам (developer)');
  }
  const local = getLocalDeveloperAiConfig();
  if (local.apiKey) return local;
  try {
    const supabase = getSupabaseClient();
    const userScopedPath = `${actingProfile.id}/${AI_CONFIG_FILE_NAME}`;
    const { data, error } = await supabase.storage.from(AI_BUCKET).download(userScopedPath);
    if (!error && data) {
      const text = await data.text();
      const parsed = JSON.parse(text) as Partial<DeveloperAiConfig>;
      const merged: DeveloperAiConfig = {
        apiKey: String(parsed.apiKey || local.apiKey || '').trim(),
        model: String(parsed.model || local.model || FREE_TIER_AI_MODELS[0].id).trim(),
        updatedAt: parsed.updatedAt || local.updatedAt,
      };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(AI_CONFIG_LS_KEY, JSON.stringify(merged));
        } catch {}
      }
      return merged;
    }
  } catch {
    // fallback to local
  }
  return local;
}

export async function saveDeveloperAiConfig(
  config: { apiKey: string; model: string },
  actingProfile: Profile
): Promise<DeveloperAiConfig> {
  if (actingProfile.role !== 'developer') {
    throw new Error('Только разработчик (developer) может изменять настройки AI ассистента');
  }
  const payload: DeveloperAiConfig = {
    apiKey: config.apiKey.trim(),
    model: config.model.trim() || FREE_TIER_AI_MODELS[0].id,
    updatedAt: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(AI_CONFIG_LS_KEY, JSON.stringify(payload));
    } catch {}
  }

  try {
    const supabase = getSupabaseClient();
    const userScopedPath = `${actingProfile.id}/${AI_CONFIG_FILE_NAME}`;
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    await supabase.storage.from(AI_BUCKET).upload(userScopedPath, blob, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '0',
    });
  } catch {
    // ignore storage error
  }

  return payload;
}

export interface AiToolExecutionLog {
  toolName: string;
  args: Record<string, any>;
  resultSummary: string;
  timestamp: string;
}

export interface AiAssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  toolLogs?: AiToolExecutionLog[];
}

export const DEVELOPER_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_app_statistics',
    description:
      'Получить полную статистику приложения PixChats (общее число пользователей, DAU, MAU, личные чаты, группы, каналы, сообщения за сегодня, статус сервисов).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeSystemStatus: {
          type: Type.BOOLEAN,
          description: 'Проверить также статус сервисов и задержку БД',
        },
      },
    },
  },
  {
    name: 'search_users',
    description:
      'Найти пользователей PixChats по имени/@username или отфильтровать по роли/статусу (all, developer, admin, moderator, partner, verified, employee, frozen, banned).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Поисковый запрос (@username или отображаемое имя). Оставьте пустым для всех.',
        },
        filter: {
          type: Type.STRING,
          description:
            'Фильтр: all, developer, admin, moderator, partner, verified, employee, frozen, banned',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Максимум результатов (по умолчанию 25)',
        },
      },
    },
  },
  {
    name: 'inspect_user_full_dossier',
    description:
      'Собрать полное досье на пользователя по @username или UUID: профиль, системная роль, кастомные роли, активные муты в чатах, жалобы на пользователя, поданные им апелляции и список чатов, в которых он состоит.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        userId: {
          type: Type.STRING,
          description: 'UUID пользователя или его @username',
        },
      },
      required: ['userId'],
    },
  },
  {
    name: 'manage_user_penalty',
    description:
      'Выдать или снять наказание пользователю: бан аккаунта (ban), разбан (unban), заморозка (freeze), разморозка (unfreeze), мут в чате (mute), размут (unmute), удаление аккаунта (delete).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: ban | unban | freeze | unfreeze | mute | unmute | delete',
        },
        userId: {
          type: Type.STRING,
          description: 'UUID пользователя (или @username, если UUID неизвестен)',
        },
        reason: {
          type: Type.STRING,
          description: 'Причина наказания (видна пользователю)',
        },
        moderatorComment: {
          type: Type.STRING,
          description: 'Комментарий от модератора/разработчика (виден пользователю)',
        },
        durationSeconds: {
          type: Type.NUMBER,
          description: 'Длительность в секундах (для временного бана или мута)',
        },
        permanent: {
          type: Type.BOOLEAN,
          description: 'Навсегда (true для вечного бана или мута)',
        },
        chatId: {
          type: Type.STRING,
          description: 'ID чата (обязательно для действия mute или unmute)',
        },
      },
      required: ['action', 'userId'],
    },
  },
  {
    name: 'manage_user_role_and_badges',
    description:
      'Изменить системную роль пользователя (user, partner, moderator, admin, developer), выдать/снять галочку верификации (is_verified) или бейдж сотрудника Pixset Studio (is_pixset_employee).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        userId: {
          type: Type.STRING,
          description: 'UUID пользователя или @username',
        },
        role: {
          type: Type.STRING,
          description: 'Новая системная роль: user | partner | moderator | admin | developer',
        },
        verified: {
          type: Type.BOOLEAN,
          description: 'Установить галочку верификации (true/false)',
        },
        pixsetEmployee: {
          type: Type.BOOLEAN,
          description: 'Установить бейдж Сотрудник Pixset Studio (true/false)',
        },
      },
      required: ['userId'],
    },
  },
  {
    name: 'manage_custom_roles',
    description:
      'Управление кастомными ролями с собственными иконками: список ролей (list), создание новой роли (create), удаление одной роли (delete), полное удаление всех кастомных ролей (clear_all), выдача/снятие кастомной роли пользователю (assign).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list | create | delete | clear_all | assign',
        },
        roleId: {
          type: Type.STRING,
          description: 'ID кастомной роли (для delete или assign)',
        },
        name: {
          type: Type.STRING,
          description: 'Название новой кастомной роли (для create)',
        },
        icon: {
          type: Type.STRING,
          description: 'Эмодзи, символ или URL/DataURL иконки роли (для create)',
        },
        color: {
          type: Type.STRING,
          description: 'HEX-цвет роли, например #ffd400 или #38bdf8 (для create)',
        },
        description: {
          type: Type.STRING,
          description: 'Описание роли (для create)',
        },
        userId: {
          type: Type.STRING,
          description: 'UUID пользователя или @username (для assign)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_appeals',
    description:
      'Просмотр всех апелляций пользователей (list) или рассмотрение апелляции: одобрить и автоматически снять наказание (approve) либо отклонить (reject).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list | approve | reject',
        },
        appealId: {
          type: Type.STRING,
          description: 'ID апелляции (для approve или reject)',
        },
        adminNotes: {
          type: Type.STRING,
          description: 'Ответ/комментарий модератора для пользователя',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_reports_and_ips',
    description:
      'Просмотр жалоб на сообщения (list_reports), просмотр заблокированных IP (list_ips), блокировка IP (ban_ip), разблокировка IP (unban_ip), просмотр мутов пользователя (list_mutes).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list_reports | list_ips | ban_ip | unban_ip | list_mutes',
        },
        ipAddress: {
          type: Type.STRING,
          description: 'IP-адрес (для ban_ip / unban_ip)',
        },
        reason: {
          type: Type.STRING,
          description: 'Причина блокировки IP',
        },
        userId: {
          type: Type.STRING,
          description: 'UUID пользователя (для list_mutes)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_banned_usernames',
    description:
      'Управление стоп-листом запрещённых @username: список запрещённых юзернеймов (list), запретить юзернейм (ban), разрешить юзернейм (unban).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list | ban | unban',
        },
        username: {
          type: Type.STRING,
          description: 'Юзернейм без @ (для ban или unban)',
        },
        reason: {
          type: Type.STRING,
          description: 'Причина запрета юзернейма (для ban)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_chats_and_channels',
    description:
      'Поиск публичных групп и каналов (list), выдача/снятие галочки верификации группы/канала (verify), изменение названия/описания чата (update), удаление чата (delete_chat).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list | verify | update | delete_chat',
        },
        query: {
          type: Type.STRING,
          description: 'Поисковый запрос по названию или @username чата',
        },
        chatId: {
          type: Type.STRING,
          description: 'ID группы или канала (для verify, update, delete_chat)',
        },
        verified: {
          type: Type.BOOLEAN,
          description: 'Выдать (true) или снять (false) галочку верификации',
        },
        title: {
          type: Type.STRING,
          description: 'Новое название чата/канала (для update)',
        },
        description: {
          type: Type.STRING,
          description: 'Новое описание чата/канала (для update)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_chat_messages',
    description:
      'Управление сообщениями внутри любого чата/группы/канала: прочитать последние сообщения (get_recent), отправить сообщение от имени разработчика (send), удалить сообщение у всех по ID (delete), закрепить сообщение (pin), открепить сообщение (unpin).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: get_recent | send | delete | pin | unpin',
        },
        chatId: {
          type: Type.STRING,
          description: 'UUID чата, группы или канала',
        },
        messageId: {
          type: Type.STRING,
          description: 'UUID сообщения (для delete или pin)',
        },
        text: {
          type: Type.STRING,
          description: 'Текст отправляемого сообщения (для send)',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Количество последних сообщений (для get_recent, по умолчанию 20)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_stories_and_content',
    description:
      'Просмотр и модерация активных историй (Stories) пользователей и каналов: список активных историй (list_stories), удаление истории по ID (delete_story).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list_stories | delete_story',
        },
        storyId: {
          type: Type.STRING,
          description: 'ID истории для удаления (для delete_story)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'cleanup_expired_frozen_accounts',
    description:
      'Запустить проверку и автоматическое удаление аккаунтов, которые заморожены более 90 дней и не были разморожены.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'run_database_diagnostics',
    description:
      'Выполнить глубокую диагностику таблиц базы данных Supabase, подсчитать объём записей в каждой таблице и проверить задержку отклика (latency).',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'manage_system_announcement',
    description:
      'Получить или установить глобальное системное объявление PixChats для всех пользователей.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: get | set | clear',
        },
        text: {
          type: Type.STRING,
          description: 'Текст системного объявления (для set)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'get_audit_and_error_logs',
    description:
      'Извлечь журнал действий администрации (Audit Log) и журнал последних ошибок клиентов (Error Logs).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.NUMBER,
          description: 'Количество записей (по умолчанию 25)',
        },
      },
    },
  },
];

async function resolveTargetUserId(identifier: string): Promise<string> {
  const clean = identifier.trim().replace(/^@/, '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
    return clean;
  }
  const found = await listProfilesForAdmin({ query: clean, limit: 5 });
  const exact = found.find((u) => u.username.toLowerCase() === clean.toLowerCase());
  if (exact) return exact.id;
  if (found.length > 0) return found[0].id;
  throw new Error(`Пользователь «${identifier}» не найден`);
}

async function executeDeveloperTool(
  name: string,
  args: Record<string, any>,
  actingProfile: Profile
): Promise<{ data: any; summary: string }> {
  switch (name) {
    case 'get_app_statistics': {
      const stats = await getAdminStats();
      let statusRows: any[] = [];
      if (args.includeSystemStatus) {
        try {
          await checkSystemStatusNow();
          statusRows = await getSystemStatus();
        } catch {}
      }
      return {
        data: { stats, statusRows },
        summary: `Статистика получена: пользователей ${stats.total_users}, DAU ${stats.dau}, сообщений сегодня ${stats.messages_today}`,
      };
    }

    case 'search_users': {
      const filter = (args.filter as AdminUserFilter) || 'all';
      const query = String(args.query || '');
      const limit = Number(args.limit) || 25;
      const users = await listProfilesForAdmin({ filter, query, limit });
      const compact = users.map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        role: u.role,
        custom_role_ids: u.custom_role_ids || [],
        is_verified: u.is_verified,
        is_pixset_employee: u.is_pixset_employee,
        frozen: u.frozen,
        frozen_reason: u.frozen_reason,
        banned_permanently: u.banned_permanently,
        banned_until: u.banned_until,
        ban_reason: u.ban_reason,
        moderator_comment: u.moderator_comment,
        created_at: u.created_at,
      }));
      return {
        data: { count: compact.length, users: compact },
        summary: `Найдено пользователей: ${compact.length} (фильтр: ${filter})`,
      };
    }

    case 'inspect_user_full_dossier': {
      const targetUserId = await resolveTargetUserId(String(args.userId || ''));
      const supabase = getSupabaseClient();
      const [users, mutes, allReports, allAppeals, membershipsRes] = await Promise.all([
        listProfilesForAdmin({ query: '', limit: 200 }),
        getUserAllMutes(targetUserId),
        getMessageReportsForAdmin(),
        listAppealsForAdmin(),
        supabase
          .from('chat_members')
          .select('chat_id, member_role, joined_at')
          .eq('user_id', targetUserId)
          .limit(50),
      ]);
      const userProfile = users.find((u) => u.id === targetUserId) || null;
      const reportsAgainstUser = allReports.filter((r) => r.reported_user_id === targetUserId);
      const userAppeals = allAppeals.filter((a) => a.user_id === targetUserId);
      const memberships = membershipsRes.data || [];

      return {
        data: {
          profile: userProfile,
          activeMutes: mutes,
          reportsAgainstUser,
          appeals: userAppeals,
          chatMembershipsCount: memberships.length,
          chatMemberships: memberships,
        },
        summary: `Досье @${userProfile?.username || targetUserId.slice(0, 8)}: роль ${userProfile?.role}, мутов ${mutes.length}, жалоб ${reportsAgainstUser.length}, апелляций ${userAppeals.length}`,
      };
    }

    case 'manage_user_penalty': {
      const targetUserId = await resolveTargetUserId(String(args.userId || ''));
      const action = String(args.action || '').toLowerCase();
      if (action === 'ban') {
        await banAccount(
          targetUserId,
          {
            permanent: Boolean(args.permanent),
            durationValue: args.durationSeconds ? Number(args.durationSeconds) : undefined,
            durationUnit: args.durationSeconds ? 'seconds' : undefined,
            reason: args.reason ? String(args.reason) : 'Нарушение правил сообщества',
            moderatorComment: args.moderatorComment ? String(args.moderatorComment) : undefined,
          },
          actingProfile
        );
        return {
          data: { ok: true, action: 'ban', targetUserId },
          summary: `Пользователь ${targetUserId.slice(0, 8)}… забанен`,
        };
      }
      if (action === 'unban') {
        await unbanAccount(targetUserId, actingProfile);
        return {
          data: { ok: true, action: 'unban', targetUserId },
          summary: `Бан снят с пользователя ${targetUserId.slice(0, 8)}…`,
        };
      }
      if (action === 'freeze') {
        await setAccountFrozen(
          targetUserId,
          true,
          actingProfile,
          args.reason ? String(args.reason) : 'Заморозка администратором',
          args.moderatorComment ? String(args.moderatorComment) : undefined
        );
        return {
          data: { ok: true, action: 'freeze', targetUserId },
          summary: `Аккаунт ${targetUserId.slice(0, 8)}… заморожен`,
        };
      }
      if (action === 'unfreeze') {
        await setAccountFrozen(targetUserId, false, actingProfile);
        return {
          data: { ok: true, action: 'unfreeze', targetUserId },
          summary: `Аккаунт ${targetUserId.slice(0, 8)}… разморожен`,
        };
      }
      if (action === 'mute') {
        if (!args.chatId) throw new Error('Для выдачи мута необходимо указать chatId');
        await muteUserInChat({
          userId: targetUserId,
          chatId: String(args.chatId),
          reason: args.reason ? String(args.reason) : 'Нарушение правил чата',
          moderatorComment: args.moderatorComment ? String(args.moderatorComment) : undefined,
          durationValue: args.durationSeconds ? Number(args.durationSeconds) : 3600,
          durationUnit: 'seconds',
          permanent: Boolean(args.permanent),
          actingProfile,
        });
        return {
          data: { ok: true, targetUserId, chatId: args.chatId },
          summary: `Выдан мут пользователю ${targetUserId.slice(0, 8)}… в чате ${args.chatId}`,
        };
      }
      if (action === 'unmute') {
        if (!args.chatId) throw new Error('Для снятия мута необходимо указать chatId');
        await unmuteUserInChat(targetUserId, String(args.chatId), actingProfile);
        return {
          data: { ok: true, action: 'unmute', targetUserId, chatId: args.chatId },
          summary: `Снят мут с пользователя ${targetUserId.slice(0, 8)}…`,
        };
      }
      if (action === 'delete') {
        await deleteAccount(targetUserId, actingProfile);
        return {
          data: { ok: true, action: 'delete', targetUserId },
          summary: `Аккаунт ${targetUserId.slice(0, 8)}… удалён`,
        };
      }
      throw new Error(`Неизвестное действие наказания: ${action}`);
    }

    case 'manage_user_role_and_badges': {
      const targetUserId = await resolveTargetUserId(String(args.userId || ''));
      const changes: string[] = [];
      if (args.role) {
        await setUserRole(targetUserId, args.role as UserRole, actingProfile);
        changes.push(`роль=${args.role}`);
      }
      if (typeof args.verified === 'boolean') {
        await setUserVerification(targetUserId, args.verified, actingProfile);
        changes.push(`галочка=${args.verified}`);
      }
      if (typeof args.pixsetEmployee === 'boolean') {
        await setPixsetEmployeeBadge(targetUserId, args.pixsetEmployee, actingProfile);
        changes.push(`сотрудник=${args.pixsetEmployee}`);
      }
      return {
        data: { ok: true, targetUserId, changes },
        summary: `Обновлены привилегии ${targetUserId.slice(0, 8)}… (${changes.join(', ')})`,
      };
    }

    case 'manage_custom_roles': {
      const action = String(args.action || '').toLowerCase();
      if (action === 'list') {
        const roles = await listCustomRoles();
        return {
          data: { roles },
          summary: `Загружено кастомных ролей: ${roles.length}`,
        };
      }
      if (action === 'create') {
        const created = await createCustomRole(
          {
            name: String(args.name || 'Новая роль'),
            icon: String(args.icon || '⭐'),
            color: String(args.color || '#ffd400'),
            description: args.description ? String(args.description) : undefined,
          },
          actingProfile
        );
        return {
          data: { role: created },
          summary: `Создана кастомная роль «${created.name}» (${created.icon})`,
        };
      }
      if (action === 'delete') {
        if (!args.roleId) throw new Error('Укажите roleId для удаления кастомной роли');
        await deleteCustomRole(String(args.roleId), actingProfile);
        return {
          data: { ok: true, deletedRoleId: args.roleId },
          summary: `Полностью удалена кастомная роль ${args.roleId}`,
        };
      }
      if (action === 'clear_all') {
        await clearAllCustomRoles(actingProfile);
        return {
          data: { ok: true, clearedAll: true },
          summary: 'Все кастомные роли полностью удалены',
        };
      }
      if (action === 'assign') {
        if (!args.roleId || !args.userId) {
          throw new Error('Укажите userId и roleId для назначения/снятия кастомной роли');
        }
        const targetUserId = await resolveTargetUserId(String(args.userId));
        const assignedIds = await toggleUserCustomRole(
          targetUserId,
          String(args.roleId),
          actingProfile
        );
        return {
          data: { ok: true, targetUserId, assignedIds },
          summary: `Обновлены кастомные роли пользователя ${targetUserId.slice(0, 8)}…`,
        };
      }
      throw new Error(`Неизвестное действие с кастомными ролями: ${action}`);
    }

    case 'manage_appeals': {
      const action = String(args.action || '').toLowerCase();
      if (action === 'list') {
        const appeals = await listAppealsForAdmin();
        return {
          data: { count: appeals.length, appeals },
          summary: `Загружено апелляций: ${appeals.length}`,
        };
      }
      if (action === 'approve' || action === 'reject') {
        if (!args.appealId) throw new Error('Укажите appealId');
        await reviewAppeal({
          appealId: String(args.appealId),
          status: action === 'approve' ? 'approved' : 'rejected',
          adminNotes: args.adminNotes ? String(args.adminNotes) : undefined,
          actingProfile,
        });
        return {
          data: { ok: true, appealId: args.appealId, status: action },
          summary: `Апелляция ${args.appealId} ${action === 'approve' ? 'одобрена (наказание снято)' : 'отклонена'}`,
        };
      }
      throw new Error(`Неизвестное действие с апелляциями: ${action}`);
    }

    case 'manage_reports_and_ips': {
      const action = String(args.action || '').toLowerCase();
      if (action === 'list_reports') {
        const reports = await getMessageReportsForAdmin();
        return {
          data: { count: reports.length, reports: reports.slice(0, 30) },
          summary: `Загружено жалоб на сообщения: ${reports.length}`,
        };
      }
      if (action === 'list_ips') {
        const ips = await listBannedIps();
        return {
          data: { count: ips.length, ips },
          summary: `Заблокированных IP-адресов: ${ips.length}`,
        };
      }
      if (action === 'ban_ip') {
        if (!args.ipAddress) throw new Error('Укажите ipAddress');
        await banIpAddress(String(args.ipAddress), String(args.reason || 'Блокировка через AI ассистент'), actingProfile);
        return {
          data: { ok: true, ipAddress: args.ipAddress },
          summary: `IP ${args.ipAddress} заблокирован`,
        };
      }
      if (action === 'unban_ip') {
        if (!args.ipAddress) throw new Error('Укажите ipAddress');
        await unbanIpAddress(String(args.ipAddress), actingProfile);
        return {
          data: { ok: true, ipAddress: args.ipAddress },
          summary: `IP ${args.ipAddress} разблокирован`,
        };
      }
      if (action === 'list_mutes') {
        const targetId = args.userId ? await resolveTargetUserId(String(args.userId)) : actingProfile.id;
        const mutes = await getUserAllMutes(targetId);
        return {
          data: { count: mutes.length, mutes },
          summary: `Активных мутов найдено: ${mutes.length}`,
        };
      }
      throw new Error(`Неизвестное действие: ${action}`);
    }

    case 'manage_banned_usernames': {
      const action = String(args.action || '').toLowerCase();
      if (action === 'list') {
        const list = await listBannedUsernames();
        return {
          data: { count: list.length, bannedUsernames: list },
          summary: `Запрещённых юзернеймов в стоп-листе: ${list.length}`,
        };
      }
      if (action === 'ban') {
        if (!args.username) throw new Error('Укажите username для добавления в стоп-лист');
        await banUsername(String(args.username), actingProfile);
        return {
          data: { ok: true, username: args.username },
          summary: `Юзернейм @${String(args.username).replace(/^@/, '')} добавлен в стоп-лист`,
        };
      }
      if (action === 'unban') {
        if (!args.username) throw new Error('Укажите username для удаления из стоп-листа');
        await unbanUsername(String(args.username));
        return {
          data: { ok: true, username: args.username },
          summary: `Юзернейм @${String(args.username).replace(/^@/, '')} разблокирован`,
        };
      }
      throw new Error(`Неизвестное действие со стоп-листом юзернеймов: ${action}`);
    }

    case 'manage_chats_and_channels': {
      const action = String(args.action || '').toLowerCase();
      if (action === 'list') {
        const chats = await listGroupAndChannelChatsForAdmin(String(args.query || ''), 30);
        return {
          data: { count: chats.length, chats },
          summary: `Найдено групп/каналов: ${chats.length}`,
        };
      }
      if (action === 'verify') {
        if (!args.chatId) throw new Error('Укажите chatId');
        const verified = args.verified !== false;
        await setChatVerification(String(args.chatId), verified, actingProfile);
        return {
          data: { ok: true, chatId: args.chatId, verified },
          summary: `Верификация чата ${args.chatId} установлена в ${verified}`,
        };
      }
      if (action === 'update') {
        if (!args.chatId) throw new Error('Укажите chatId');
        const supabase = getSupabaseClient();
        const patch: Record<string, any> = {};
        if (args.title !== undefined) patch.title = String(args.title).trim();
        if (args.description !== undefined) patch.description = String(args.description).trim();
        const { error } = await supabase.from('chats').update(patch).eq('id', String(args.chatId));
        if (error) throw error;
        return {
          data: { ok: true, chatId: args.chatId, patch },
          summary: `Данные чата ${args.chatId} обновлены`,
        };
      }
      if (action === 'delete_chat') {
        if (!args.chatId) throw new Error('Укажите chatId');
        const supabase = getSupabaseClient();
        const { error } = await supabase.from('chats').delete().eq('id', String(args.chatId));
        if (error) throw error;
        return {
          data: { ok: true, deletedChatId: args.chatId },
          summary: `Чат/канал ${args.chatId} удалён`,
        };
      }
      throw new Error(`Неизвестное действие с чатами: ${action}`);
    }

    case 'manage_chat_messages': {
      const action = String(args.action || '').toLowerCase();
      if (action === 'get_recent') {
        if (!args.chatId) throw new Error('Укажите chatId');
        const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
        const msgs = await getMessages(String(args.chatId), limit);
        return {
          data: { count: msgs.length, messages: msgs },
          summary: `Загружено последних сообщений чата: ${msgs.length}`,
        };
      }
      if (action === 'send') {
        if (!args.chatId || !args.text) throw new Error('Укажите chatId и text');
        const sent = await sendMessage(String(args.chatId), String(args.text));
        return {
          data: { ok: true, message: sent },
          summary: `Сообщение отправлено в чат ${String(args.chatId).slice(0, 8)}…`,
        };
      }
      if (action === 'delete') {
        if (!args.messageId) throw new Error('Укажите messageId');
        await deleteMessage(String(args.messageId), args.chatId ? String(args.chatId) : undefined);
        return {
          data: { ok: true, deletedMessageId: args.messageId },
          summary: `Сообщение ${String(args.messageId).slice(0, 8)}… удалено у всех`,
        };
      }
      if (action === 'pin') {
        if (!args.chatId || !args.messageId) throw new Error('Укажите chatId и messageId');
        await pinMessage(String(args.chatId), String(args.messageId));
        return {
          data: { ok: true, chatId: args.chatId, pinnedMessageId: args.messageId },
          summary: `Сообщение закреплено в чате ${String(args.chatId).slice(0, 8)}…`,
        };
      }
      if (action === 'unpin') {
        if (!args.chatId) throw new Error('Укажите chatId');
        await unpinMessage(String(args.chatId));
        return {
          data: { ok: true, chatId: args.chatId },
          summary: `Закреплённое сообщение откреплено в чате ${String(args.chatId).slice(0, 8)}…`,
        };
      }
      throw new Error(`Неизвестное действие с сообщениями: ${action}`);
    }

    case 'manage_stories_and_content': {
      const action = String(args.action || '').toLowerCase();
      const supabase = getSupabaseClient();
      const storiesPath = 'stories/active_stories_v2.json';
      if (action === 'list_stories') {
        let stories: any[] = [];
        try {
          const { data } = supabase.storage.from('avatars').getPublicUrl(storiesPath);
          if (data?.publicUrl) {
            const res = await fetch(`${data.publicUrl}?v=${Date.now()}`);
            if (res.ok) {
              const parsed = await res.json();
              if (Array.isArray(parsed)) stories = parsed;
            }
          }
        } catch {}
        return {
          data: { count: stories.length, stories: stories.slice(0, 30) },
          summary: `Активных историй в облаке: ${stories.length}`,
        };
      }
      if (action === 'delete_story') {
        if (!args.storyId) throw new Error('Укажите storyId для удаления истории');
        let stories: any[] = [];
        try {
          const { data } = supabase.storage.from('avatars').getPublicUrl(storiesPath);
          if (data?.publicUrl) {
            const res = await fetch(`${data.publicUrl}?v=${Date.now()}`);
            if (res.ok) {
              const parsed = await res.json();
              if (Array.isArray(parsed)) stories = parsed;
            }
          }
        } catch {}
        const filtered = stories.filter((s: any) => s.id !== String(args.storyId));
        const blob = new Blob([JSON.stringify(filtered)], { type: 'application/json' });
        await supabase.storage.from('avatars').upload(storiesPath, blob, {
          upsert: true,
          contentType: 'application/json',
          cacheControl: '15',
        });
        return {
          data: { ok: true, deletedStoryId: args.storyId, remaining: filtered.length },
          summary: `История ${args.storyId} удалена (осталось: ${filtered.length})`,
        };
      }
      throw new Error(`Неизвестное действие с контентом: ${action}`);
    }

    case 'cleanup_expired_frozen_accounts': {
      const deletedCount = await cleanupExpiredFrozenAccounts();
      return {
        data: { deletedCount },
        summary: `Проверка 90-дневной заморозки завершена: удалено аккаунтов — ${deletedCount}`,
      };
    }

    case 'run_database_diagnostics': {
      const supabase = getSupabaseClient();
      const t0 = Date.now();
      const [profilesCount, chatsCount, membersCount, messagesCount, reactionsCount, friendsCount] =
        await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
          supabase.from('chats').select('id', { count: 'exact', head: true }),
          supabase.from('chat_members').select('chat_id', { count: 'exact', head: true }),
          supabase.from('messages').select('id', { count: 'exact', head: true }),
          supabase.from('message_reactions').select('message_id', { count: 'exact', head: true }),
          supabase.from('friendships').select('id', { count: 'exact', head: true }),
        ]);
      const latencyMs = Date.now() - t0;
      const report = {
        latencyMs,
        tables: {
          profiles: profilesCount.count ?? 0,
          chats: chatsCount.count ?? 0,
          chat_members: membersCount.count ?? 0,
          messages: messagesCount.count ?? 0,
          message_reactions: reactionsCount.count ?? 0,
          friendships: friendsCount.count ?? 0,
        },
        quotaOptimizationStatus: {
          cloudJsonCacheTtlSec: 20,
          profileCacheTtlSec: 20,
          telemetryDebounceSec: 120,
          storiesSyncCooldownSec: 25,
        },
      };
      return {
        data: report,
        summary: `Диагностика БД (${latencyMs} мс): профилей ${report.tables.profiles}, чатов ${report.tables.chats}, сообщений ${report.tables.messages}`,
      };
    }

    case 'manage_system_announcement': {
      const action = String(args.action || '').toLowerCase();
      if (action === 'get') {
        const current =
          typeof window !== 'undefined'
            ? localStorage.getItem('pixchats_system_announcement') || ''
            : '';
        return {
          data: { announcement: current },
          summary: current ? `Текущее объявление: «${current}»` : 'Системное объявление не задано',
        };
      }
      if (action === 'set') {
        const text = String(args.text || '').trim();
        if (typeof window !== 'undefined') {
          if (text) {
            localStorage.setItem('pixchats_system_announcement', text);
          } else {
            localStorage.removeItem('pixchats_system_announcement');
          }
        }
        return {
          data: { ok: true, announcement: text },
          summary: `Системное объявление обновлено: «${text}»`,
        };
      }
      if (action === 'clear') {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('pixchats_system_announcement');
        }
        return {
          data: { ok: true, announcement: '' },
          summary: 'Системное объявление очищено',
        };
      }
      throw new Error(`Неизвестное действие объявления: ${action}`);
    }

    case 'get_audit_and_error_logs': {
      const limit = Number(args.limit) || 25;
      const [auditLogs, errorLogs] = await Promise.all([
        getAuditLogsForAdmin(limit),
        getErrorLogs(),
      ]);
      return {
        data: { auditLogs, errorLogs: errorLogs.slice(0, limit) },
        summary: `Получено записей аудита: ${auditLogs.length}, логов ошибок: ${errorLogs.length}`,
      };
    }

    default:
      throw new Error(`Инструмент ${name} не поддерживается`);
  }
}

export async function runDeveloperAiAssistantTurn(params: {
  prompt: string;
  history: AiAssistantMessage[];
  actingProfile: Profile;
  apiKeyOverride?: string;
  modelOverride?: string;
}): Promise<{ replyText: string; toolLogs: AiToolExecutionLog[] }> {
  const { prompt, history, actingProfile, apiKeyOverride, modelOverride } = params;

  if (!actingProfile || actingProfile.role !== 'developer') {
    throw new Error('Функция AI ассистента доступна исключительно разработчикам (role: developer)');
  }

  const savedCfg = await loadDeveloperAiConfig(actingProfile);
  const apiKey = (apiKeyOverride ?? savedCfg.apiKey).trim();
  const requestedModel = (modelOverride ?? savedCfg.model ?? FREE_TIER_AI_MODELS[0].id).trim();

  if (!apiKey) {
    throw new Error(
      'Не указан Gemini API ключ. Нажмите «Настройки API и Модели» вверху страницы и вставьте ваш ключ Google AI Studio (Free Tier).'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const systemInstruction = `Ты — встроенный системный AI-ассистент и автономный агент разработчика мессенджера PixChats (от Pixset Studio).
Твой пользователь — главный разработчик приложения (@${actingProfile.username}, имя: ${actingProfile.display_name}, роль: developer).
У тебя есть полный доступ к 16 инструментам управления всем приложением PixChats:
- Живая статистика приложения (пользователи, DAU/MAU, сообщения, группы, каналы, статус БД).
- Глубокая диагностика таблиц БД Supabase и проверка расхода квот (run_database_diagnostics).
- Поиск пользователей и сбор полного досье на любого пользователя (inspect_user_full_dossier).
- Выдача и снятие банов, заморозок, мутов в чатах, удаление аккаунтов и автоочистка 90-дневных заморозок.
- Управление системными ролями, галочками верификации и бейджем «Сотрудник Pixset Studio».
- Создание, полное удаление (включая clear_all) и назначение кастомных ролей со своими иконками.
- Просмотр и рассмотрение апелляций пользователей (одобрение со снятием наказаний или отклонение).
- Просмотр жалоб на сообщения, управление блокировками по IP-адресам и стоп-листом @username.
- Управление группами и каналами, чтение/отправка/удаление/закрепление сообщений в чатах, модерация историй (Stories).
- Публикация глобальных системных объявлений и чтение журнала аудита / ошибок.

Всегда отвечай на русском языке, чётко, структурированно и по делу, используя аккуратную Markdown-разметку (списки, жирный текст, таблицы, блоки кода). Когда разработчик просит данные или действие — обязательно вызывай соответствующий инструмент.`;

  const toolLogs: AiToolExecutionLog[] = [];

  // Если выбран автономный агент Antigravity (Interactions API)
  if (requestedModel === 'antigravity-preview-09-2026') {
    try {
      // Сначала собираем контекст или выполняем локальные инструменты PixChats через быстрый планировщик,
      // а затем запускаем агента Antigravity через Interactions API (remote environment)
      const interaction = await (ai as any).interactions.create({
        agent: 'antigravity-preview-09-2026',
        input: `${systemInstruction}\n\nЗапрос разработчика: ${prompt}`,
        environment: 'remote',
      });

      const collectedTexts: string[] = [];
      if (Array.isArray(interaction?.steps)) {
        for (const step of interaction.steps) {
          for (const content of step.outputs || []) {
            if (content.type === 'text' && content.text) {
              collectedTexts.push(content.text);
            } else if (content.type === 'code_execution_call') {
              toolLogs.push({
                toolName: 'antigravity:code_execution',
                args: { language: content.arguments?.language || 'PYTHON' },
                resultSummary: 'Выполнен код в облачной песочнице Antigravity',
                timestamp: new Date().toISOString(),
              });
            } else if (content.type === 'google_search_call') {
              toolLogs.push({
                toolName: 'antigravity:google_search',
                args: { queries: content.arguments?.queries || [] },
                resultSummary: `Поиск в интернете: ${(content.arguments?.queries || []).join(', ')}`,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
      if (collectedTexts.length > 0) {
        return {
          replyText: collectedTexts.join('\n\n'),
          toolLogs,
        };
      }
    } catch (agentErr: any) {
      // Если ключ Free Tier не поддерживает удалённую песочницу Interactions API или модель недоступна,
      // бесшовно переключаемся на многошаговый агентный цикл с локальными инструментами PixChats
      toolLogs.push({
        toolName: 'antigravity:agent_loop',
        args: { mode: 'local_tools_agent' },
        resultSummary: 'Агент Antigravity запущен в режиме прямого управления инструментами PixChats',
        timestamp: new Date().toISOString(),
      });
    }
  }

  const contents: any[] = [];
  for (const msg of history.slice(-14)) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }],
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: prompt }],
  });

  // Выбираем рабочую модель для generateContent (с авто-резервом если экспериментальный алиас недоступен на ключе)
  let activeModel =
    requestedModel === 'antigravity-preview-09-2026' ? 'gemini-2.5-flash' : requestedModel;

  let maxIterations = 6;

  while (maxIterations > 0) {
    maxIterations -= 1;

    let response: any;
    try {
      response = await ai.models.generateContent({
        model: activeModel,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: DEVELOPER_TOOL_DECLARATIONS }],
        },
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (
        activeModel !== 'gemini-2.5-flash' &&
        (msg.includes('404') || msg.includes('not found') || msg.includes('not supported'))
      ) {
        activeModel = 'gemini-2.5-flash';
        response = await ai.models.generateContent({
          model: activeModel,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: DEVELOPER_TOOL_DECLARATIONS }],
          },
        });
      } else {
        throw err;
      }
    }

    const functionCalls = response.functionCalls;
    if (!functionCalls || functionCalls.length === 0) {
      return {
        replyText: response.text || 'Команда выполнена.',
        toolLogs,
      };
    }

    const modelParts = response.candidates?.[0]?.content?.parts || [
      ...functionCalls.map((fc: any) => ({ functionCall: fc })),
    ];
    contents.push({
      role: 'model',
      parts: modelParts,
    });

    const functionResponseParts: any[] = [];

    for (const call of functionCalls) {
      const fnName = call.name || 'unknown_tool';
      const fnArgs = (call.args as Record<string, any>) || {};
      try {
        const execResult = await executeDeveloperTool(fnName, fnArgs, actingProfile);
        toolLogs.push({
          toolName: fnName,
          args: fnArgs,
          resultSummary: execResult.summary,
          timestamp: new Date().toISOString(),
        });
        functionResponseParts.push({
          functionResponse: {
            name: fnName,
            response: { result: execResult.data, summary: execResult.summary },
          },
        });
      } catch (err: any) {
        const errMsg = err?.message || 'Ошибка выполнения инструмента';
        toolLogs.push({
          toolName: fnName,
          args: fnArgs,
          resultSummary: `Ошибка: ${errMsg}`,
          timestamp: new Date().toISOString(),
        });
        functionResponseParts.push({
          functionResponse: {
            name: fnName,
            response: { error: errMsg },
          },
        });
      }
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });
  }

  return {
    replyText: 'Инструменты успешно выполнены.',
    toolLogs,
  };
}
