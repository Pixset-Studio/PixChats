/**
 * Бесплатный geo-IP лукап без ключа. Если сервис недоступен — по умолчанию
 * считаем, что страна не Россия (чтобы не прятать кнопку зря из-за сетевой ошибки).
 */
export async function isRussianVisitor(): Promise<boolean> {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) return false;
    const data = await res.json();
    return data.country_code === 'RU';
  } catch {
    return false;
  }
}
