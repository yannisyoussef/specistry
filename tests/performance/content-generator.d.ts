export declare function pageSource(
  section: number,
  index: number,
  apiLink?: string,
  perSection?: number,
): string;
export declare const PING_DOCUMENT: string;
export declare function writeSyntheticSite(
  root: string,
  options?: {
    readonly pages?: number;
    readonly sections?: number;
    readonly openapi?: string | object;
  },
): Promise<number>;
