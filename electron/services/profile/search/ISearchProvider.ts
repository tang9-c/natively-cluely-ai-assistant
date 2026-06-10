export interface ISearchProvider {
  quotaExhausted?: boolean;
  search?(query: string, options?: any): Promise<any>;
}
