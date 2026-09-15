import * as SecureStore from 'expo-secure-store';

// Tokens live in the platform keystore (iOS Keychain / Android Keystore),
// never in plain AsyncStorage. Same shape and key name as the web session.
export type Session = {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  user: { id: string; phone: string | null; email?: string | null; role: string };
};

const KEY = 'bhookmark.session';

export async function loadStoredSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function storeSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
