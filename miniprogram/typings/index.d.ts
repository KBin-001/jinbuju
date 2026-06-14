interface IAppOption {
  globalData: {
    cloudEnvId: string;
  };
}

declare const wx: any;
declare function App<T>(options: T): void;
declare function Page<T>(options: T): void;
