import { readFile as fsReadFile, writeFile as fsWriteFile, unlink, readdir } from 'fs/promises';
import { resolve } from 'path';

export async function readFile(path: string): Promise<string> {
  try {
    return await fsReadFile(resolve(path), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read file at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeFile(path: string, content: string): Promise<void> {
  try {
    await fsWriteFile(resolve(path), content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write file at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function deleteFile(path: string): Promise<void> {
  try {
    await unlink(resolve(path));
  } catch (error) {
    throw new Error(`Failed to delete file at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function listDirectory(path: string): Promise<string[]> {
  try {
    const entries = await readdir(resolve(path), { withFileTypes: true });
    return entries.map(entry => {
      if (entry.isDirectory()) {
        return `[DIR] ${entry.name}`;
      }
      return entry.name;
    });
  } catch (error) {
    throw new Error(`Failed to list directory at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
