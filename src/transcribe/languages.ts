export interface WhisperLanguageOption {
  code: string;
  label: string;
}

export const WHISPER_LANGUAGES: WhisperLanguageOption[] = [
  { code: 'en', label: 'English (Fast .en)' },
  { code: 'hi', label: 'Hindi / Hinglish (hi)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'de', label: 'German (de)' },
  { code: 'pt', label: 'Portuguese (pt)' },
  { code: 'ja', label: 'Japanese (ja)' },
  { code: 'ko', label: 'Korean (ko)' },
  { code: 'ar', label: 'Arabic (ar)' },
  { code: 'id', label: 'Indonesian (id)' },
  { code: 'ru', label: 'Russian (ru)' },
  { code: 'zh', label: 'Chinese (zh)' },
  { code: 'tr', label: 'Turkish (tr)' },
  { code: 'it', label: 'Italian (it)' },
  { code: 'ur', label: 'Urdu (ur)' },
  { code: 'ta', label: 'Tamil (ta)' },
  { code: 'te', label: 'Telugu (te)' },
  { code: 'bn', label: 'Bengali (bn)' },
  { code: 'mr', label: 'Marathi (mr)' },
  { code: 'pa', label: 'Punjabi (pa)' },
];

/**
 * Selects the English-only or multilingual Whisper ONNX checkpoint for the chosen language.
 */
export function selectAsrModelForLanguage(baseModelId: string, languageCode: string): string {
  if (languageCode === 'en') {
    return baseModelId;
  }
  return baseModelId.replace('.en_timestamped', '_timestamped').replace(/\.en$/, '');
}
