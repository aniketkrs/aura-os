/**
 * Google Drive API — list, search, read files (terminal-native)
 */
import * as https from 'https';
import { getValidToken } from './google-auth';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
}

function apiGet(path: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(
      { hostname: 'www.googleapis.com', path, headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); } });
      }
    ).on('error', reject);
  });
}

export async function listDriveFiles(query?: string, maxResults = 20): Promise<DriveFile[]> {
  const token = await getValidToken();
  const q = query
    ? `&q=${encodeURIComponent(query + ' and trashed=false')}`
    : '&q=trashed=false';
  const fields = 'files(id,name,mimeType,modifiedTime,size,webViewLink)';
  const resp = await apiGet(
    `/drive/v3/files?pageSize=${maxResults}${q}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime+desc`,
    token
  ) as { files?: DriveFile[] };
  return resp.files || [];
}

export async function readDriveFile(fileId: string): Promise<string> {
  const token = await getValidToken();
  // For Google Docs, export as plain text
  const meta = await apiGet(`/drive/v3/files/${fileId}?fields=mimeType,name`, token) as { mimeType: string; name: string };

  let exportPath: string;
  if (meta.mimeType === 'application/vnd.google-apps.document') {
    exportPath = `/drive/v3/files/${fileId}/export?mimeType=text%2Fplain`;
  } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
    exportPath = `/drive/v3/files/${fileId}/export?mimeType=text%2Fcsv`;
  } else {
    exportPath = `/drive/v3/files/${fileId}?alt=media`;
  }

  return new Promise((resolve, reject) => {
    https.get(
      { hostname: 'www.googleapis.com', path: exportPath, headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d.slice(0, 5000)));
      }
    ).on('error', reject);
  });
}

export function formatDriveList(files: DriveFile[]): string {
  if (!files.length) return '  No files found.';
  const typeIcon = (mime: string) => {
    if (mime.includes('document'))    return '📄';
    if (mime.includes('spreadsheet')) return '📊';
    if (mime.includes('presentation'))return '📋';
    if (mime.includes('folder'))      return '📁';
    if (mime.includes('pdf'))         return '📕';
    if (mime.includes('image'))       return '🖼 ';
    return '📄';
  };
  return files.map((f, i) => {
    const icon = typeIcon(f.mimeType);
    const idx  = String(i + 1).padStart(3);
    const name = f.name.slice(0, 45).padEnd(45);
    const date = f.modifiedTime.slice(0, 10);
    const size = f.size ? `${Math.round(parseInt(f.size) / 1024)}KB` : '  —  ';
    return `  ${idx}  ${icon} ${name}  ${date}  ${size.padStart(8)}`;
  }).join('\n');
}
