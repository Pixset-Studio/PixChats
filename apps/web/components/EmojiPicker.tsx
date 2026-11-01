'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { getAllStickers, type StickerItem } from '../lib/stickers';

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onSelectMedia?: (mediaUrl: string, caption?: string, stickerId?: string) => void;
  onClose?: () => void;
  title?: string;
  className?: string;
  enableMedia?: boolean;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  emojis: string[];
}

interface GifItem {
  id: string;
  label: string;
  url: string;
  previewUrl: string;
}

const EMOJI_CATEGORIES: Category[] = [
  {
    id: 'smileys',
    name: 'Смайлы',
    icon: '😀',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','🫠','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','😵‍💫','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','🎃'
    ],
  },
  {
    id: 'gestures',
    name: 'Жесты и люди',
    icon: '👋',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','🫦','💋','🫂','👶','🧒','👦','👧','🧑','👨','👩','🧓','👴','👵','👨‍🦰','👩‍🦰','👨‍🦱','👩‍🦱','👨‍🦳','👩‍🦳','👨‍🦲','👩‍🦲','🧔'
    ],
  },
  {
    id: 'hearts',
    name: 'Сердца и символы',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','❇️','✳️','❎','🌐','💠','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧️','🚻','🚮','📶','🈁','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','🟰','♾️','💲','™️','©️','®️','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️'
    ],
  },
  {
    id: 'nature',
    name: 'Животные и природа',
    icon: '🐶',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🌲','🌳','🌴','🪵','🌱','🌿','☘️','🍀','🎍','🪴','🎋','🍃','🍂','🍁','🍄','🐚','🪨','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌎','🌍','🌏','🪐','💫','⭐️','🌟','✨','⚡️','☄️','💥','🔥','🌪️','🌈','☀️','🌤️','⛅️','🌥️','☁️','🌦️','🌧️','🌨️','🌩️','❄️','☃️','⛄️','🌬️','💨','💧','💦','🫧','☔️','☂️','🌊','🌫️'
    ],
  },
  {
    id: 'food',
    name: 'Еда и напитки',
    icon: '🍕',
    emojis: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕️','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂'
    ],
  },
  {
    id: 'activity',
    name: 'Активности',
    icon: '⚽',
    emojis: [
      '⚽️','🏀','🏈','⚾️','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳️','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','🤺','⛹️','🤾','🧗','🧘','🏄','🏊','🤽','🚣','🚵','🚴','🏇','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩'
    ],
  },
  {
    id: 'objects',
    name: 'Предметы',
    icon: '🚀',
    emojis: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🚨','🚔','🚍','🚘','🚖','🚂','🚆','🚇','🚊','🚉','🚁','✈️','🛫','🛬','🚀','🛸','🛰️','⛵️','🚤','🛥️','🚢','⚓️','🪝','⛽️','🚧','🚦','🚥','🚏','🗺️','🗿','🗽','🗼','🏰','🎡','🎢','🏖️','🏝️','🏔️','🌋','🏕️','⛺️','🏠','🏡','🏢','🏨','🏦','🏥','🏤','🏣','🏫','🏬','🏭','🏛️','💎','💍','👑','🧢','👓','🕶️','📱','💻','🖥️','🖨️','📷','📸','📹','🎥','📽️','📺','📻','🎙️','⏰','⏱️','⏲️','⏳','⌛️','💡','🔦','🕯️','🧯','💵','💴','💶','💷','🪙','💰','💳','📦','📫','📬','📪','📁','📂','📄','📃','📊','📈','📉','📌','📍','📎','📏','📐','✂️','🔒','🔓','🔏','🔐','🔑','🗝️','🔨','🪓','🔧','🪛','🔩','⚙️','🧲','🔫','💣','🧨','🗡️','⚔️','🛡️','🔮','🧿','🪞','🪑','🚪','🛏️','🛋️','🚿','🛁','🧼','🧽','🧹','🧺','🧻','🧴','🧸','🎁','🎈','🎏','🎀','🪄','🪅','🎊'
    ],
  },
];

// Публичный ключ Tenor v1 для бесконечной ленты и поиска любых GIF
const TENOR_API_KEY = 'LIVDSRZULELA';
const GIPHY_PUBLIC_KEY = 'dc6zaTOxFJmzC';
const GIF_PAGE_SIZE = 24;

async function fetchGifPage(
  query: string,
  cursor: string
): Promise<{ items: GifItem[]; nextCursor: string }> {
  const cleanQuery = query.trim();

  // 1. Основной источник: Tenor API (поддерживает русский и английский поиск + бесконечный курсор pos)
  try {
    const endpoint = cleanQuery
      ? `https://g.tenor.com/v1/search?key=${TENOR_API_KEY}&q=${encodeURIComponent(cleanQuery)}&limit=${GIF_PAGE_SIZE}&locale=ru_RU&media_filter=minimal${cursor ? `&pos=${encodeURIComponent(cursor)}` : ''}`
      : `https://g.tenor.com/v1/trending?key=${TENOR_API_KEY}&limit=${GIF_PAGE_SIZE}&locale=ru_RU&media_filter=minimal${cursor ? `&pos=${encodeURIComponent(cursor)}` : ''}`;

    const res = await fetch(endpoint);
    if (res.ok) {
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      const mapped: GifItem[] = results
        .map((item: any) => {
          const mediaObj = Array.isArray(item.media) ? item.media[0] : null;
          const fullUrl =
            mediaObj?.gif?.url ||
            mediaObj?.mediumgif?.url ||
            mediaObj?.tinygif?.url;
          const previewUrl =
            mediaObj?.tinygif?.url ||
            mediaObj?.nanogif?.url ||
            fullUrl;
          if (!fullUrl) return null;
          return {
            id: String(item.id || `${fullUrl}-${Math.random()}`),
            label: String(item.content_description || item.title || cleanQuery || 'GIF'),
            url: fullUrl,
            previewUrl: previewUrl || fullUrl,
          };
        })
        .filter(Boolean) as GifItem[];

      return {
        items: mapped,
        nextCursor: data?.next ? String(data.next) : '',
      };
    }
  } catch {
    // Переходим к резервному источнику Giphy
  }

  // 2. Резервный источник: Giphy API с offset-пагинацией
  try {
    const offset = parseInt(cursor || '0', 10) || 0;
    const giphyUrl = cleanQuery
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_PUBLIC_KEY}&q=${encodeURIComponent(cleanQuery)}&limit=${GIF_PAGE_SIZE}&offset=${offset}&lang=ru`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_PUBLIC_KEY}&limit=${GIF_PAGE_SIZE}&offset=${offset}`;

    const res = await fetch(giphyUrl);
    if (res.ok) {
      const data = await res.json();
      const results = Array.isArray(data?.data) ? data.data : [];
      const mapped: GifItem[] = results
        .map((item: any) => {
          const fullUrl =
            item?.images?.downsized?.url ||
            item?.images?.original?.url ||
            item?.images?.fixed_height?.url;
          const previewUrl =
            item?.images?.fixed_width_small?.url ||
            item?.images?.fixed_height_small?.url ||
            fullUrl;
          if (!fullUrl) return null;
          return {
            id: String(item.id || `${fullUrl}-${Math.random()}`),
            label: String(item.title || cleanQuery || 'GIF'),
            url: fullUrl,
            previewUrl: previewUrl || fullUrl,
          };
        })
        .filter(Boolean) as GifItem[];

      return {
        items: mapped,
        nextCursor: mapped.length > 0 ? String(offset + mapped.length) : '',
      };
    }
  } catch {
    // ignore
  }

  return { items: [], nextCursor: '' };
}

export function EmojiPicker({
  onSelect,
  onSelectMedia,
  onClose,
  title = 'Эмодзи',
  className = '',
  enableMedia = true,
}: EmojiPickerProps) {
  const [pickerType, setPickerType] = useState<'emoji' | 'stickers' | 'gif'>('emoji');
  const [activeTab, setActiveTab] = useState('smileys');
  const [search, setSearch] = useState('');
  const [stickers, setStickers] = useState<StickerItem[]>([]);

  // Бесконечная лента GIF и живой поиск
  const [gifQuery, setGifQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [gifCursor, setGifCursor] = useState<string>('');
  const [gifLoading, setGifLoading] = useState(false);
  const [gifHasMore, setGifHasMore] = useState(true);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    setStickers(getAllStickers());
    const reload = () => setStickers(getAllStickers());
    window.addEventListener('pixchats:stickers_updated', reload);
    return () => window.removeEventListener('pixchats:stickers_updated', reload);
  }, []);

  // Загрузка первой страницы GIF при открытии вкладки или изменении поискового запроса (с debounce 300мс)
  useEffect(() => {
    if (pickerType !== 'gif') return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setGifLoading(true);
      loadingMoreRef.current = true;
      const { items, nextCursor } = await fetchGifPage(gifQuery, '');
      if (!cancelled) {
        setGifs(items);
        setGifCursor(nextCursor);
        setGifHasMore(Boolean(nextCursor) && items.length > 0);
        setGifLoading(false);
        loadingMoreRef.current = false;
      }
    }, gifQuery.trim() ? 280 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickerType, gifQuery]);

  // Догрузка следующей страницы GIF при прокрутке вниз (бесконечный скролл)
  const loadMoreGifs = useCallback(async () => {
    if (loadingMoreRef.current || !gifHasMore || !gifCursor) return;
    loadingMoreRef.current = true;
    setGifLoading(true);

    const { items, nextCursor } = await fetchGifPage(gifQuery, gifCursor);
    setGifs((prev) => {
      const existingIds = new Set(prev.map((g) => g.id));
      const uniqueNew = items.filter((g) => !existingIds.has(g.id));
      return [...prev, ...uniqueNew];
    });
    setGifCursor(nextCursor);
    setGifHasMore(Boolean(nextCursor) && items.length > 0);
    setGifLoading(false);
    loadingMoreRef.current = false;
  }, [gifCursor, gifHasMore, gifQuery]);

  const handleGifScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 180) {
      void loadMoreGifs();
    }
  };

  const filteredEmojis = useMemo(() => {
    const q = search.trim();
    if (!q) {
      const cat = EMOJI_CATEGORIES.find((c) => c.id === activeTab);
      return cat ? cat.emojis : [];
    }
    const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
    return Array.from(new Set(all)).filter((e) => e.includes(q));
  }, [activeTab, search]);

  return (
    <div className={`emoji-picker-container ${className}`} onClick={(e) => e.stopPropagation()}>
      <div className="emoji-picker-header">
        <span className="emoji-picker-title">{title}</span>
        {onClose && (
          <button type="button" className="emoji-picker-close" onClick={onClose} title="Закрыть">
            ✕
          </button>
        )}
      </div>

      {enableMedia && onSelectMedia && (
        <div className="picker-type-switch">
          <button
            type="button"
            className={`picker-type-btn ${pickerType === 'emoji' ? 'active' : ''}`}
            onClick={() => setPickerType('emoji')}
          >
            😀 Эмодзи
          </button>
          <button
            type="button"
            className={`picker-type-btn ${pickerType === 'stickers' ? 'active' : ''}`}
            onClick={() => setPickerType('stickers')}
          >
            👾 Стикеры
          </button>
          <button
            type="button"
            className={`picker-type-btn ${pickerType === 'gif' ? 'active' : ''}`}
            onClick={() => setPickerType('gif')}
          >
            🎬 GIF
          </button>
        </div>
      )}

      {pickerType === 'emoji' && (
        <>
          <div className="emoji-picker-search-box">
            <input
              type="text"
              className="emoji-picker-search-input"
              placeholder="Поиск эмодзи..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="emoji-picker-clear-search" onClick={() => setSearch('')}>
                ✕
              </button>
            )}
          </div>

          {!search && (
            <div className="emoji-picker-tabs">
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`emoji-picker-tab ${activeTab === cat.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(cat.id)}
                  title={cat.name}
                >
                  <span>{cat.icon}</span>
                </button>
              ))}
            </div>
          )}

          <div className="emoji-picker-grid">
            {filteredEmojis.map((emoji, idx) => (
              <button
                key={`${emoji}-${idx}`}
                type="button"
                className="emoji-picker-item"
                onClick={() => onSelect(emoji)}
              >
                {emoji}
              </button>
            ))}
            {filteredEmojis.length === 0 && (
              <div className="emoji-picker-empty">Ничего не найдено</div>
            )}
          </div>
        </>
      )}

      {pickerType === 'stickers' && (
        <div className="stickers-grid">
          {stickers.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '28px 14px',
                color: 'var(--text-muted)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Стикеров пока нет.
              <br />
              Вы можете добавить свои собственные стикеры в разделе <strong>Админка (/admin)</strong>.
            </div>
          ) : (
            stickers.map((stk) => (
              <button
                key={stk.id}
                type="button"
                className="sticker-item-btn"
                onClick={() => onSelectMedia?.(stk.dataUrl, `Стикер: ${stk.title}`, stk.id)}
                title={`${stk.title} (${stk.pack})`}
              >
                <img src={stk.dataUrl} alt={stk.title} className="sticker-preview-img" />
                <span className="sticker-label">{stk.title}</span>
              </button>
            ))
          )}
        </div>
      )}

      {pickerType === 'gif' && (
        <>
          <div className="emoji-picker-search-box">
            <input
              type="text"
              className="emoji-picker-search-input"
              placeholder="Искать любые GIF (мемы, коты, аниме, эмоции)..."
              value={gifQuery}
              onChange={(e) => setGifQuery(e.target.value)}
            />
            {gifQuery && (
              <button type="button" className="emoji-picker-clear-search" onClick={() => setGifQuery('')}>
                ✕
              </button>
            )}
          </div>
          <div className="gif-grid" onScroll={handleGifScroll}>
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                className="gif-item-btn"
                onClick={() => onSelectMedia?.(gif.url, `GIF: ${gif.label}`)}
                title={gif.label}
              >
                <img src={gif.previewUrl} alt={gif.label} className="gif-item-img" loading="lazy" />
              </button>
            ))}

            {gifLoading && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: '14px 8px',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                }}
              >
                Загрузка GIF…
              </div>
            )}

            {!gifLoading && gifs.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: '24px 12px',
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}
              >
                Ничего не найдено по запросу «{gifQuery}»
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
