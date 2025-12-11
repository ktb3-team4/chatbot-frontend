// components/EmojiPicker.js

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// Lazy-load the heavy picker to reduce initial bundle size.
const Picker = dynamic(() => import('@emoji-mart/react'), {
  ssr: false,
  loading: () => null,
});

function EmojiPicker({ onSelect }) {
  const [emojiData, setEmojiData] = useState(null);

  useEffect(() => {
    let isMounted = true;

    // Load data on demand so the bundle stays light until the picker is opened.
    import('@emoji-mart/data/sets/14/native')
      .then((mod) => {
        if (isMounted) {
          setEmojiData(mod.default || mod);
        }
      })
      .catch((error) => {
        console.error('Failed to load emoji data', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const pickerProps = useMemo(
    () => ({
      data: emojiData,
      onEmojiSelect: onSelect,
      theme: 'light',
      set: 'native',
      locale: 'ko',
      previewPosition: 'none',
      skinTonePosition: 'none',
      emojiButtonSize: 30,
      emojiSize: 20,
      maxFrequentRows: 4,
      perLine: 9,
    }),
    [emojiData, onSelect]
  );

  if (!emojiData) return null;

  return <Picker {...pickerProps} />;
}

export default EmojiPicker;
