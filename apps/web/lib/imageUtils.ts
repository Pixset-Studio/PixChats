export interface ImageBase64Options {
  cropSquare?: boolean;
  preserveAlpha?: boolean;
}

/**
 * Сжимает изображение (аватар или стикер) и возвращает Base64 Data URL,
 * полностью исключая хранение на сервере/Supabase Storage.
 */
export async function fileToBase64Image(
  file: File,
  maxSize = 256,
  quality = 0.85,
  options: ImageBase64Options = {}
): Promise<string> {
  const { cropSquare = true, preserveAlpha = false } = options;

  // Если это SVG, сохраняем сразу как Base64 Data URL без потерь
  if (file.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать SVG'));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось декодировать изображение'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.imageSmoothingQuality = 'high';

        if (cropSquare) {
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          const targetDim = Math.min(maxSize, minDim);
          canvas.width = targetDim;
          canvas.height = targetDim;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetDim, targetDim);
        } else {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height, 1));
          const targetW = Math.max(1, Math.round(img.width * scale));
          const targetH = Math.max(1, Math.round(img.height * scale));
          canvas.width = targetW;
          canvas.height = targetH;
          ctx.drawImage(img, 0, 0, targetW, targetH);
        }

        try {
          const webpData = canvas.toDataURL('image/webp', quality);
          if (webpData.startsWith('data:image/webp')) {
            resolve(webpData);
            return;
          }
        } catch {}

        if (preserveAlpha) {
          resolve(canvas.toDataURL('image/png'));
          return;
        }
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

