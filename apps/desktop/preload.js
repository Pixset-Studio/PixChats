// Пусто намеренно: приложению не нужен доступ к Node.js API из веб-кода —
// вся работа идёт через обычные веб-API (fetch к Supabase, Notification, MediaRecorder и т.д.),
// поэтому contextIsolation остаётся включённым, а surface атаки — минимальным.
