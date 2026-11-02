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
  toggleUserCustomRole,
  listAppealsForAdmin,
  reviewAppeal,
  getMessageReportsForAdmin,
  listBannedIps,
  banIpAddress,
  unbanIpAddress,
  listGroupAndChannelChatsForAdmin,
  setChatVerification,
  getAuditLogsForAdmin,
  getErrorLogs,
  getSystemStatus,
  checkSystemStatusNow,
} from './admin';
import { getSupabaseClient } from './supabaseClient';

export interface FreeTierAiModelOption {
  id: string;
  label: string;
  badge: string;
  description: string;
}

export const FREE_TIER_AI_MODELS: FreeTierAiModelOption[] = [
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    badge: 'Рекомендуется • Free Tier',
    description: 'Быстрая мультимодальная модель с высокой точностью вызова инструментов управления PixChats.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    badge: 'Максимальные лимиты • Free Tier',
    description: 'Сверхбыстрая и экономичная модель с максимальной квотой запросов в бесплатном тарифе.',
  },
  {
    id: 'gemini-flash-latest',
    label: 'Gemini Flash (Latest Auto)',
    badge: 'Автообновление • Free Tier',
    description: 'Автоматический алиас на актуальную стабильную модель семейства Gemini Flash.',
  },
];

const AI_CONFIG_LS_KEY = 'pixchats_dev_ai_assistant_config_v1';
const AI_BUCKET = 'avatars';
const AI_CONFIG_CLOUD_PATH = 'system/dev_ai_assistant_config_v1.json';

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
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage.from(AI_BUCKET).download(AI_CONFIG_CLOUD_PATH);
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
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    await supabase.storage.from(AI_BUCKET).upload(AI_CONFIG_CLOUD_PATH, blob, {
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

const DEVELOPER_TOOL_DECLARATIONS: FunctionDeclaration[] = [
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
      'Управление кастомными ролями с собственными иконками: список ролей (list), создание новой роли (create), удаление роли (delete), выдача/снятие кастомной роли пользователю (assign).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list | create | delete | assign',
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
    name: 'manage_chats_and_channels',
    description:
      'Поиск публичных групп и каналов (list) или выдача/снятие галочки верификации группы/канала (verify).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Действие: list | verify',
        },
        query: {
          type: Type.STRING,
          description: 'Поисковый запрос по названию или @username чата',
        },
        chatId: {
          type: Type.STRING,
          description: 'ID группы или канала (для verify)',
        },
        verified: {
          type: Type.BOOLEAN,
          description: 'Выдать (true) или снять (false) галочку верификации',
        },
      },
      required: ['action'],
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
          summary: `Удалена кастомная роль ${args.roleId}`,
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
      throw new Error(`Неизвестное действие с чатами: ${action}`);
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
  const model = (modelOverride ?? savedCfg.model ?? FREE_TIER_AI_MODELS[0].id).trim();

  if (!apiKey) {
    throw new Error(
      'Не указан Gemini API ключ. Нажмите «Настроить API ключ» вверху страницы и вставьте ваш ключ Google AI Studio (Free Tier).'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const systemInstruction = `Ты — встроенный системный AI-ассистент разработчика мессенджера PixChats (от Pixset Studio).
Твой пользователь — разработчик приложения (@${actingProfile.username}, имя: ${actingProfile.display_name}, роль: developer).
У тебя есть полный доступ к инструментам управления всем приложением PixChats:
- Извлечение живой статистики приложения (пользователи, DAU/MAU, сообщения, группы, каналы, статус БД).
- Поиск и фильтрация пользователей, проверка их банов, мутов, заморозок и ролей.
- Выдача и снятие банов, заморозок, мутов в чатах, удаление аккаунтов.
- Управление системными ролями, галочками верификации и бейджем «Сотрудник Pixset Studio».
- Создание, удаление и назначение кастомных ролей со своими иконками и цветами.
- Просмотр и рассмотрение апелляций пользователей (одобрение со снятием наказаний или отклонение).
- Просмотр жалоб на сообщения, управление блокировками по IP-адресам.
- Управление публичными группами и каналами, верификация каналов.
- Публикация глобальных системных объявлений и чтение журнала аудита / ошибок.

Всегда отвечай на русском языке, чётко, структурированно и по делу. Когда разработчик просит данные или действие — обязательно вызывай соответствующий инструмент.`;

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

  const toolLogs: AiToolExecutionLog[] = [];
  let maxIterations = 5;

  while (maxIterations > 0) {
    maxIterations -= 1;

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: DEVELOPER_TOOL_DECLARATIONS }],
      },
    });

    const functionCalls = response.functionCalls;
    if (!functionCalls || functionCalls.length === 0) {
      return {
        replyText: response.text || 'Команда выполнена.',
        toolLogs,
      };
    }

    const modelParts = response.candidates?.[0]?.content?.parts || [
      ...functionCalls.map((fc) => ({ functionCall: fc })),
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
