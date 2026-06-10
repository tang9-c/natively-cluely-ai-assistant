import type { ISearchProvider } from './ISearchProvider';

export class NativelySearchProvider implements ISearchProvider {
  public quotaExhausted = false;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(_query: string, _options?: any): Promise<any> {
    // MVP placeholder — company research is out of scope.
    return { results: [] };
  }
}
