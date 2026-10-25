/** Анимированная заглушка загрузки — три прыгающие точки вместо текста "Загрузка…". */
export function Loading() {
  return (
    <div className="loader-center" role="status" aria-label="Загрузка">
      <div className="loader-dots">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/** Скелетоны строк чата с мерцающим эффектом — для списка чатов. */
export function ChatListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row" style={{ opacity: 1 - i * 0.1 }}>
          <div className="skeleton skeleton-avatar" />
          <div className="skeleton-lines">
            <div className="skeleton skeleton-line" style={{ width: `${55 + ((i * 17) % 30)}%` }} />
            <div className="skeleton skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}
