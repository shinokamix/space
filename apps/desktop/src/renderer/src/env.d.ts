/// <reference types="vite/client" />

interface Window {
  readonly space: {
    readonly platform: NodeJS.Platform;
    readonly getRuntimeConfig: () => Promise<{
      readonly token: string;
      readonly url: string;
    }>;
  };
}
