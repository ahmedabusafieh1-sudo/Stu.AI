import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'local';
const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR || './data/storage');

// Ensure base storage directory exists
if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

export interface StorageProvider {
  saveFile(key: string, buffer: Buffer, mimeType: string): Promise<string>;
  saveFileFromPath(key: string, sourcePath: string, mimeType: string): Promise<string>;
  getFileBuffer(key: string): Promise<Buffer>;
  getFileStream(key: string): Promise<Readable>;
  getFilePath(key: string): string;
  deleteFile(key: string): Promise<void>;
  fileExists(key: string): Promise<boolean>;
}

// ----------------------------------------------------
// Local Persistent Storage Implementation
// ----------------------------------------------------
class LocalDiskStorage implements StorageProvider {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private resolvePath(key: string): string {
    // Prevent path traversal
    const safeKey = key.replace(/\.\./g, '').replace(/^[/\\]+/, '');
    return path.join(this.baseDir, safeKey);
  }

  getFilePath(key: string): string {
    return this.resolvePath(key);
  }

  async saveFileFromPath(key: string, sourcePath: string, _mimeType: string): Promise<string> {
    const fullPath = this.resolvePath(key);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    try {
      await fs.promises.rename(sourcePath, fullPath);
    } catch {
      await fs.promises.copyFile(sourcePath, fullPath);
      await fs.promises.unlink(sourcePath).catch(() => {});
    }
    return key;
  }

  async saveFile(key: string, buffer: Buffer, _mimeType: string): Promise<string> {
    const fullPath = this.resolvePath(key);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, buffer);
    return key;
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    const fullPath = this.resolvePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${key}`);
    }
    return await fs.promises.readFile(fullPath);
  }

  async getFileStream(key: string): Promise<Readable> {
    const fullPath = this.resolvePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${key}`);
    }
    return fs.createReadStream(fullPath);
  }

  async deleteFile(key: string): Promise<void> {
    const fullPath = this.resolvePath(key);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  async fileExists(key: string): Promise<boolean> {
    const fullPath = this.resolvePath(key);
    return fs.existsSync(fullPath);
  }
}

// Export singleton instance
export const storage: StorageProvider = new LocalDiskStorage(LOCAL_STORAGE_DIR);
