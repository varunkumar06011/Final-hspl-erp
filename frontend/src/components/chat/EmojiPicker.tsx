import { useState } from 'react';
import { Box, ButtonBase, Popover, Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';

// A small built-in set (no extra dependency): enough for everyday internal chat.
const CATEGORIES: { key: string; icon: string; emojis: string[] }[] = [
  {
    key: 'smileys',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😋', '😛', '😜', '🤪', '🤗', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😌', '😔', '😪',
      '😴', '😷', '🤒', '🤕', '🤢', '🥵', '🥶', '😵', '🤯', '😎', '🤓', '😕', '😟', '🙁', '😮', '😲',
      '😳', '🥺', '😢', '😭', '😱', '😖', '😞', '😓', '😩', '😫', '😤', '😡', '🤬', '😈', '💀', '🤡',
    ],
  },
  {
    key: 'gestures',
    icon: '👍',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '✋',
      '🖐️', '👏', '🙌', '👐', '🤝', '🙏', '💪', '✍️', '🤳', '👀', '🧠', '👷', '👨‍⚕️', '👩‍⚕️', '👨‍💼', '👩‍💼',
    ],
  },
  {
    key: 'symbols',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '💥', '💫', '⭐', '🌟', '✨', '🔥',
      '✅', '❌', '⚠️', '❗', '❓', '➕', '➖', '➡️', '⬅️', '⬆️', '⬇️', '🔔', '🎉', '🎊', '🏆', '🚀',
    ],
  },
  {
    key: 'objects',
    icon: '🏗️',
    emojis: [
      '🏗️', '🏥', '🧱', '🔧', '🔨', '🛠️', '⚙️', '🧰', '📦', '🚚', '🚧', '⛑️', '🦺', '💡', '🔌', '🔋',
      '📄', '📑', '📎', '📌', '📝', '📅', '📊', '📈', '📉', '💰', '💵', '🧾', '🏦', '💳', '📞', '📍',
      '⏰', '⌛', '☕', '🍽️', '🌧️', '☀️', '🕐', '🔒', '🔑', '📷', '🖥️', '📱',
    ],
  },
];

interface EmojiPickerProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onPick: (emoji: string) => void;
}

export default function EmojiPicker({ anchorEl, onClose, onPick }: EmojiPickerProps) {
  const { t } = useTranslation('chat');
  const [tab, setTab] = useState(0);
  const category = CATEGORIES[tab];

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 320, maxWidth: 'calc(100vw - 24px)' } } }}
    >
      <Tabs
        value={tab}
        onChange={(_e, v: number) => setTab(v)}
        variant="fullWidth"
        sx={{ minHeight: 40, borderBottom: 1, borderColor: 'divider' }}
      >
        {CATEGORIES.map((c) => (
          <Tab
            key={c.key}
            label={c.icon}
            aria-label={t(`emoji_${c.key}`)}
            sx={{ minHeight: 40, minWidth: 0, fontSize: 20, p: 0 }}
          />
        ))}
      </Tabs>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', p: 1, maxHeight: 220, overflowY: 'auto' }}>
        {category.emojis.map((emoji) => (
          <ButtonBase
            key={emoji}
            onClick={() => onPick(emoji)}
            sx={{ fontSize: 24, height: 38, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
          >
            {emoji}
          </ButtonBase>
        ))}
      </Box>
    </Popover>
  );
}
