interface IAppOption {
  globalData: {
    cloudEnvId: string;
  };
  onLaunch(): void;
}

declare const wx: any;
declare function App<T>(options: T): void;
declare function Page<T>(options: T): void;
declare function getCurrentPages(): Array<{ route?: string }>;

declare namespace WechatMiniprogram {
  interface TouchEvent {
    touches: Array<{ clientX: number; clientY: number }>;
    changedTouches: Array<{ clientX: number; clientY: number }>;
    currentTarget?: { dataset?: Record<string, unknown> };
  }
}
