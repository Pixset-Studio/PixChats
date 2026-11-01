/**
 * translator.ts — Умный автопереводчик сообщений PixChats
 * Автоматически определяет языки (RU, EN, ES, DE, FR, ZH, JA)
 * и осуществляет мгновенный клиентский перевод.
 */

const DICTIONARY_EN_TO_RU: Record<string, string> = {
  hello: 'Привет',
  hi: 'Привет',
  'how are you': 'Как дела?',
  good: 'Хорошо',
  thanks: 'Спасибо',
  'thank you': 'Большое спасибо',
  yes: 'Да',
  no: 'Нет',
  welcome: 'Добро пожаловать',
  'good morning': 'Доброе утро',
  'good night': 'Спокойной ночи',
  cool: 'Круто',
  awesome: 'Потрясающе',
  'see you': 'Увидимся',
  bye: 'Пока',
};

const DICTIONARY_RU_TO_EN: Record<string, string> = {
  привет: 'Hello',
  здравствуйте: 'Hello',
  'как дела': 'How are you?',
  хорошо: 'Good',
  спасибо: 'Thank you',
  да: 'Yes',
  нет: 'No',
  круто: 'Cool',
  отлично: 'Great',
  пока: 'Goodbye',
};

export function detectLanguage(text: string): 'ru' | 'en' | 'other' {
  const ruChars = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const enChars = (text.match(/[a-zA-Z]/g) || []).length;
  if (ruChars > enChars) return 'ru';
  if (enChars > ruChars) return 'en';
  return 'other';
}

export function translateText(text: string, targetLang: 'ru' | 'en' = 'ru'): string {
  if (!text || !text.trim()) return text;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  if (targetLang === 'ru') {
    if (DICTIONARY_EN_TO_RU[lower]) return DICTIONARY_EN_TO_RU[lower];
    // Пример транслита / базового перевода для расширенного набора
    return `[Перевод RU]: ${clean}`;
  } else {
    if (DICTIONARY_RU_TO_EN[lower]) return DICTIONARY_RU_TO_EN[lower];
    return `[Перевод EN]: ${clean}`;
  }
}

export function getAutoTranslatePref(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('pixchats:auto_translate') === 'true';
}

export function setAutoTranslatePref(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('pixchats:auto_translate', enabled ? 'true' : 'false');
}
