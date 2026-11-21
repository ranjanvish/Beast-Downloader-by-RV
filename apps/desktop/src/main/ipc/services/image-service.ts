import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { ImageOutput } from '../../../shared/image-download'
import {
  consumeImportedImages,
  previewImage,
  saveImages,
  scanImages
} from '../../lib/image-downloads'

export class ImageService extends IpcService {
  static readonly groupName = 'images'

  @IpcMethod()
  scan(_context: IpcContext, url: string) {
    return scanImages(url)
  }

  @IpcMethod()
  preview(_context: IpcContext, url: string) {
    return previewImage(url)
  }

  @IpcMethod()
  consumeImported(_context: IpcContext) {
    return consumeImportedImages()
  }

  @IpcMethod()
  save(
    _context: IpcContext,
    options: {
      images: { url: string; title?: string }[]
      pageUrl?: string
      output: ImageOutput
      directory?: string
    }
  ) {
    return saveImages(options)
  }
}
