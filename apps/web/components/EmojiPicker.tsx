'use client';

import React, { useState, useMemo } from 'react';

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onSelectMedia?: (mediaUrl: string, caption?: string) => void;
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

// Стикеры Pixset Studio
const PIXSET_STICKERS = [
  { id: 'byte-blaster', label: 'Byte Blaster', icon: '👾', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&auto=format&fit=crop&q=80' },
  { id: 'pixel-cat', label: 'PixCat', icon: '🐱', url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=300&auto=format&fit=crop&q=80' },
  { id: 'gg-wp', label: 'GG WP', icon: '🏆', url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=300&auto=format&fit=crop&q=80' },
  { id: 'fire-matrix', label: 'Matrix Flame', icon: '🔥', url: 'https://images.unsplash.com/photo-1544256718-3bcf237f3974?w=300&auto=format&fit=crop&q=80' },
  { id: 'cyber-heart', label: 'Neon Heart', icon: '💖', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&auto=format&fit=crop&q=80' },
  { id: 'pix-rocket', label: 'To The Moon', icon: '🚀', url: 'https://images.unsplash.com/photo-1517976487541-118fd7d93414?w=300&auto=format&fit=crop&q=80' },
  { id: 'coder-mode', label: 'Dev Mode', icon: '💻', url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=300&auto=format&fit=crop&q=80' },
  { id: 'arcade-star', label: 'Star Player', icon: '⭐', url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300&auto=format&fit=crop&q=80' },
];

// Трендовые GIF-анимации
const POPULAR_GIFS = [
  { id: 'cheers', label: 'Cheers', url: 'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif' },
  { id: 'clap', label: 'Applause', url: 'https://media.giphy.com/media/nbvFVPiEiJH6Q/giphy.gif' },
  { id: 'mindblown', label: 'Mind Blown', url: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif' },
  { id: 'cat-vibing', label: 'Cat Vibe', url: 'https://media.giphy.com/media/jpbnoe3UIa8TU8LM13/giphy.gif' },
  { id: 'popcorn', label: 'Popcorn', url: 'https://media.giphy.com/media/t3dLl0TGHCxTG/giphy.gif' },
  { id: 'thumbsup', label: 'Awesome', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
];

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

  const filteredEmojis = useMemo(() => {
    const q = search.trim();
    if (!q) {
      const cat = EMOJI_CATEGORIES.find((c) => c.id === activeTab);
      return cat ? cat.emojis : [];
    }
    const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
    return Array.from(new Set(all)).filter((e) => e.includes(q));
  }, [activeTab, search]);

  const filteredGifs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return POPULAR_GIFS;
    return POPULAR_GIFS.filter((g) => g.label.toLowerCase().includes(q));
  }, [search]);

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
          {PIXSET_STICKERS.map((stk) => (
            <button
              key={stk.id}
              type="button"
              className="sticker-item-btn"
              onClick={() => onSelectMedia?.(stk.url, `Стикер: ${stk.label}`)}
            >
              <span className="sticker-preview-char">{stk.icon}</span>
              <span className="sticker-label">{stk.label}</span>
            </button>
          ))}
        </div>
      )}

      {pickerType === 'gif' && (
        <>
          <div className="emoji-picker-search-box">
            <input
              type="text"
              className="emoji-picker-search-input"
              placeholder="Поиск GIF..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="gif-grid">
            {filteredGifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                className="gif-item-btn"
                onClick={() => onSelectMedia?.(gif.url, `GIF: ${gif.label}`)}
              >
                <img src={gif.url} alt={gif.label} className="gif-item-img" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
