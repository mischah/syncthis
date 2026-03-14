import { net, safeStorage, shell } from 'electron';
import { loadAppSettings, saveAppSettings } from './app-settings.js';
import { updateAllCredentialHelpers } from './credentials.js';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? '';
const GITHUB_SCOPE = 'repo';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GitHubUser {
  login: string;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  private: boolean;
  pushedAt: string;
  cloneUrl: string;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await net.fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: GITHUB_SCOPE }),
  });
  if (!response.ok) throw new Error(`GitHub device code request failed: ${response.status}`);
  return response.json() as Promise<DeviceCodeResponse>;
}

export async function pollForToken(deviceCode: string, interval: number): Promise<TokenResponse> {
  const deadline = Date.now() + 15 * 60 * 1000;
  let pollInterval = interval;

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval * 1000));

    const response = await net.fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = (await response.json()) as TokenResponse & { error?: string };

    if (data.access_token) return data;

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      pollInterval += 5;
      continue;
    }
    if (data.error === 'expired_token') throw new Error('Device code expired');
    if (data.error === 'access_denied') throw new Error('Authorization denied by user');

    throw new Error(`Unexpected poll response: ${data.error}`);
  }

  throw new Error('Polling timed out after 15 minutes');
}

export async function pollOnce(
  deviceCode: string,
): Promise<
  | { status: 'pending'; newInterval?: number }
  | { status: 'complete'; token: string; username: string }
  | { status: 'error'; message: string }
> {
  try {
    const response = await net.fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = (await response.json()) as TokenResponse & {
      error?: string;
      interval?: number;
    };

    if (data.access_token) {
      const user = await fetchGitHubUser(data.access_token);
      await storeToken(data.access_token, user.login);
      return { status: 'complete', token: data.access_token, username: user.login };
    }

    if (data.error === 'authorization_pending') {
      return { status: 'pending' };
    }
    if (data.error === 'slow_down') {
      return { status: 'pending', newInterval: data.interval };
    }
    if (data.error === 'expired_token') return { status: 'error', message: 'Device code expired' };
    if (data.error === 'access_denied') return { status: 'error', message: 'Authorization denied' };

    return { status: 'error', message: `Unexpected error: ${data.error}` };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const response = await net.fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`GitHub user fetch failed: ${response.status}`);
  return response.json() as Promise<GitHubUser>;
}

export async function fetchUserRepos(token: string): Promise<GitHubRepo[]> {
  const url =
    'https://api.github.com/user/repos?visibility=private&sort=pushed&direction=desc&per_page=100&affiliation=owner';
  const response = await net.fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`GitHub repos fetch failed: ${response.status}`);
  const repos = (await response.json()) as Array<{
    name: string;
    full_name: string;
    private: boolean;
    pushed_at: string;
    clone_url: string;
  }>;
  return repos.map((r) => ({
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    pushedAt: r.pushed_at,
    cloneUrl: r.clone_url,
  }));
}

export async function createGitHubRepo(token: string, name: string): Promise<GitHubRepo> {
  const response = await net.fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, private: true, auto_init: true }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      errors?: Array<{ message?: string }>;
    };
    const detail = body.errors?.[0]?.message ?? body.message ?? response.status;
    throw new Error(`GitHub repo creation failed: ${detail}`);
  }
  const repo = (await response.json()) as {
    name: string;
    full_name: string;
    private: boolean;
    pushed_at: string;
    clone_url: string;
  };
  return {
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    pushedAt: repo.pushed_at,
    cloneUrl: repo.clone_url,
  };
}

export function openDeviceAuthPage(verificationUri: string): void {
  shell.openExternal(verificationUri);
}

export async function storeToken(token: string, username: string): Promise<void> {
  const settings = await loadAppSettings();
  let encryptedToken: string;
  if (safeStorage.isEncryptionAvailable()) {
    encryptedToken = safeStorage.encryptString(token).toString('base64');
  } else {
    console.warn('safeStorage encryption unavailable; storing token in plaintext');
    encryptedToken = token;
  }
  settings.github = { token: encryptedToken, username };
  await saveAppSettings(settings);
  await updateAllCredentialHelpers(token);
}

export async function loadToken(): Promise<string | null> {
  const settings = await loadAppSettings();
  const stored = settings.github.token;
  if (!stored) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    }
    return stored;
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  const settings = await loadAppSettings();
  settings.github = {};
  await saveAppSettings(settings);
}
