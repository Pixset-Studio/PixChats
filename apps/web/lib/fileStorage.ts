/**
 * fileStorage.ts — Нулевая нагрузка на БД и Storage Supabase
 *
 * Все прикрепляемые пользователями файлы (фотографии, видео, аудио, видеокружочки, документы)
 * либо сжимаются на клиенте в ультра-легкие Base64 Data URL, либо отправляются на бесплатные
 * бессерверные хостинги временных файлов (Catbox/Litterbox).
 *
 * Благодаря этому папка Storage и БД Supabase занимают 0 байт на диске!
 */

export interface OptimizedFileResult {
  url: string;
  name: string;
  sizeBytes: number;
  isDataUrl: boolean;
}

/**
 * Автоматически сжимает изображения в браузерном Canvas до 1000px и качества 65% (WebP/JPEG Base64).
 */
export async function compressImageToDataUrl(
  file: File,
  maxWidth = 1000,
  quality = 0.65
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxWidth) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mime, quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Ошибка чтения изображения'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Ошибка загрузки файла'));
    reader.readAsDataURL(file);
  });
}

/**
 * Конвертирует файл в Data URL
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}

/**
 * Загружает файл на бесплатный анонимный файловый хостинг Catbox/Litterbox
 */
export async function uploadToFreeExternalHost(file: File): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('time', '72h'); // 72 часа хранения
    formData.append('fileToUpload', file);

    const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('http')) {
        return text.trim();
      }
    }
  } catch {}

  return await fileToDataUrl(file);
}

/**
 * Главная точка обработки вложений без использования памяти Supabase Storage
 */
export async function processZeroStorageFileAttachment(file: File): Promise<OptimizedFileResult> {
  if (file.type.startsWith('image/')) {
    const compressedDataUrl = await compressImageToDataUrl(file);
    return {
      url: compressedDataUrl,
      name: file.name,
      sizeBytes: compressedDataUrl.length,
      isDataUrl: true,
    };
  }

  if (file.size <= 250 * 1024) {
    const dataUrl = await fileToDataUrl(file);
    return {
      url: dataUrl,
      name: file.name,
      sizeBytes: dataUrl.length,
      isDataUrl: true,
    };
  }

  const extUrl = await uploadToFreeExternalHost(file);
  return {
    url: extUrl,
    name: file.name,
    sizeBytes: file.size,
    isDataUrl: extUrl.startsWith('data:'),
  };
}
