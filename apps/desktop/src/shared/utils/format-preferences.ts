import {
  buildAudioFormatPreference as buildSharedAudioFormatPreference,
  buildVideoFormatPreference as buildSharedVideoFormatPreference
} from '@vidbee/downloader-core/format-preferences'
import type { AppSettings } from '../types'

export const buildVideoFormatPreference = (settings: AppSettings): string =>
  settings.preferredAudioLanguage && /^[a-zA-Z0-9-]+$/.test(settings.preferredAudioLanguage)
    ? `bestvideo[height<=${({ best: 2160, good: 1080, normal: 720, bad: 480, worst: 360 } as const)[settings.oneClickQuality]}]+bestaudio[language=${settings.preferredAudioLanguage}]/best[language=${settings.preferredAudioLanguage}]`
    : buildSharedVideoFormatPreference({ oneClickQuality: settings.oneClickQuality })

export const buildAudioFormatPreference = (settings: AppSettings): string =>
  settings.preferredAudioLanguage && /^[a-zA-Z0-9-]+$/.test(settings.preferredAudioLanguage)
    ? `bestaudio[language=${settings.preferredAudioLanguage}]/best[language=${settings.preferredAudioLanguage}]`
    : buildSharedAudioFormatPreference({ oneClickQuality: settings.oneClickQuality })
