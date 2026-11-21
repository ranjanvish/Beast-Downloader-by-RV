import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { MixedBatchAction } from '../../../shared/mixed-download'
import { downloadLibrary } from '../../lib/download-library'
import { executeMixedBatch, mixedBatchSnapshot } from '../../lib/mixed-batch-host'
import { mixedPreview } from '../../lib/mixed-preview'

export class MixedBatchService extends IpcService {
  static readonly groupName = 'batch'
  @IpcMethod()
  library(_context: IpcContext, page = 0, kind = 'all', query = '') {
    return downloadLibrary(page, kind, query)
  }
  @IpcMethod()
  preview(_context: IpcContext, id: string, refresh = false) {
    return mixedPreview(id, refresh)
  }
  @IpcMethod()
  snapshot(_context: IpcContext, page = 0, query = '', status = 'all') {
    return mixedBatchSnapshot(page, query, status)
  }
  @IpcMethod()
  execute(_context: IpcContext, action: MixedBatchAction, body: Record<string, unknown> = {}) {
    return executeMixedBatch(action, body)
  }
}
