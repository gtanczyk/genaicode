export interface AppContextProvider {
  getContextValue<T = unknown>(key: string): Promise<T | undefined>;
  setContextValue<T = unknown>(key: string, value: T): Promise<void>;
  clearContextValue(key: string): Promise<void>;
  clearAllContext(): Promise<void>;
}

let appContextProvider: AppContextProvider | undefined;

export function registerAppContextProvider(provider: AppContextProvider) {
  appContextProvider = provider;
}

export async function getContextValue<T = unknown>(key: string) {
  if (!appContextProvider) {
    throw new Error('App context provider is not registered');
  }

  return appContextProvider.getContextValue<T>(key);
}

export async function setContextValue<T = unknown>(key: string, value: T) {
  if (!appContextProvider) {
    throw new Error('App context provider is not registered');
  }

  await appContextProvider.setContextValue(key, value);
}

export async function clearContextValue(key: string) {
  if (!appContextProvider) {
    throw new Error('App context provider is not registered');
  }

  await appContextProvider.clearContextValue(key);
}

export async function clearAllContext() {
  if (!appContextProvider) {
    throw new Error('App context provider is not registered');
  }

  await appContextProvider.clearAllContext();
}
