import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If running from src: __dirname = <project>/src/utils -> ROOT_DIR = <project>/src
// If running from dist: __dirname = <project>/dist/utils -> ROOT_DIR = <project>/dist
export const ROOT_DIR = path.join(__dirname, '..');
// Project root is one level above src/dist
export const PROJECT_ROOT = path.join(ROOT_DIR, '..');
export const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');
export const SESSIONS_DIR = path.join(UPLOADS_DIR, 'sessions');

export function toPublicUrl(absPath: string): string {
  const rel = path.relative(UPLOADS_DIR, absPath).split(path.sep).join('/');
  return `/uploads/${rel}`;
}
