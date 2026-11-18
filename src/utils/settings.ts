import type { AppSettings } from '../types';

const SETTINGS_KEY = 'travaux_maison_v3_settings';

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { geminiApiKey: '', comfyUiUrl: '' };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
      comfyUiUrl: typeof parsed.comfyUiUrl === 'string' ? parsed.comfyUiUrl : '',
    };
  } catch {
    return { geminiApiKey: '', comfyUiUrl: '' };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function hasGeminiKey(): boolean {
  return loadAppSettings().geminiApiKey.trim().length > 10;
}
