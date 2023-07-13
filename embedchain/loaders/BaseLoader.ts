import type { Input, LoaderResult } from '../models';

export class BaseLoader {
  // eslint-disable-next-line class-methods-use-this
  async loadData(_src: Input, _metaData: Record<string,string> = {}): Promise<LoaderResult> {
    throw new Error('Not implemented');
  }
}
