import type { DictatedApi } from "../shared/types";

declare global {
  interface Window {
    dictated: DictatedApi;
  }
}
