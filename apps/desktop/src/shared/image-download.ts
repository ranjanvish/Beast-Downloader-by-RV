export interface ImageSource {
  url: string
  title: string
  previewUrl?: string
  width?: number
  height?: number
  variants: { url: string; width?: number }[]
}

export interface ImageScan {
  pageUrl: string
  images: ImageSource[]
}

export type ImageOutput = 'original' | 'png' | 'jpeg' | 'webp'

export interface ImageSaveOptions {
  images: { url: string; title?: string }[]
  pageUrl?: string
  output: ImageOutput
  directory?: string
}

export interface ImageSaveResult {
  saved: { url: string; path: string }[]
  failed: { url: string; error: string }[]
  directory: string
}
