/**
 * GitHub integration — REST API v3 (Personal Access Token)
 * Requires: PAT (ghp_...) with notifications, repo scopes
 */
import * as https from 'https';
import { registerIntegration, type AppMessage } from './integration-manager';

function ghRequest<T>(
  token: string,
  method: string,
  urlPath: string,
  body?: Record<string, unknown>
): Promise<T> {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'AuraOS/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(payload ? { 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            if (!data.trim()) { resolve(undefined as T); return; }
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(parsed.message ?? `GitHub API error ${res.statusCode}`));
            } else {
              resolve(parsed as T);
            }
          } catch { reject(new Error('Invalid JSON response')); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

interface GhNotification {
  id: string;
  reason: string;
  updated_at: string;
  subject: { title: string; type: string; url: string | null };
  repository: { full_name: string };
}

interface GhRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  open_issues_count: number;
  language: string | null;
  updated_at: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  pull_request?: object;
}

// Extra functions exposed for use in the /app github command handler
export async function fetchRepos(token: string, limit = 20): Promise<GhRepo[]> {
  return ghRequest<GhRepo[]>(token, 'GET', `/user/repos?sort=updated&per_page=${limit}`);
}

export async function fetchIssues(token: string, repo: string, limit = 20): Promise<GhIssue[]> {
  return ghRequest<GhIssue[]>(token, 'GET', `/repos/${repo}/issues?state=open&per_page=${limit}`);
}

export async function fetchPRs(token: string, repo: string, limit = 20): Promise<GhIssue[]> {
  return ghRequest<GhIssue[]>(token, 'GET', `/repos/${repo}/pulls?state=open&per_page=${limit}`);
}

registerIntegration({
  id: 'github',
  name: 'GitHub',
  description: 'Repos, issues, PRs, and notifications',
  icon: '⚿',
  setupFields: [
    { key: 'pat', label: 'Personal Access Token (ghp_...)', secret: true,
      hint: 'github.com → Settings → Developer settings → Personal access tokens → Fine-grained' },
  ],

  async fetchMessages(config, limit = 20): Promise<AppMessage[]> {
    // GitHub "messages" = unread notifications
    return this.fetchNotifications!(config);
  },

  async sendMessage(config, target, text): Promise<void> {
    // target format: "owner/repo" → creates an issue
    if (!target.includes('/')) throw new Error('Target must be owner/repo (e.g. torvalds/linux)');
    await ghRequest(config.pat, 'POST', `/repos/${target}/issues`,
      { title: text.slice(0, 100), body: text });
  },

  async fetchNotifications(config): Promise<AppMessage[]> {
    const notifs = await ghRequest<GhNotification[]>(config.pat, 'GET',
      '/notifications?all=false&per_page=30');
    return (notifs ?? []).map(n => ({
      id: n.id,
      from: n.repository.full_name,
      channel: n.subject.type,
      text: n.subject.title,
      timestamp: n.updated_at,
    }));
  },
});
