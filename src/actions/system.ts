import { exec } from 'child_process';
import { promisify } from 'util';
import { hostname, userInfo, type, release, arch, platform } from 'os';

const execAsync = promisify(exec);

export async function execCommand(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) {
      console.log(`Command execution output: ${stderr}`);
    }
    return stdout.trim() || 'Command executed successfully with no output.';
  } catch (error) {
    throw new Error(`Failed to execute command: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function unlockLaptop(): Promise<string> {
  throw new Error('Unlock laptop command requires a specific script or tool path defined for this environment.');
}

export function getHostname(): string {
  return hostname();
}

export function getUsername(): string {
  return userInfo().username;
}

export function getEnvVar(name: string): string {
  return process.env[name] ?? '<not set>';
}

export function getOSInfo(): Record<string, string> {
  return { type: type(), release: release(), arch: arch(), platform: platform() };
}

const VALID_SPECIAL_FOLDERS = new Set(['Desktop', 'MyDocuments', 'MyPictures', 'MyMusic', 'Startup']);

const XDG_FOLDER_MAP: Record<string, string> = {
  Desktop: 'DESKTOP',
  MyDocuments: 'DOCUMENTS',
  MyPictures: 'PICTURES',
  MyMusic: 'MUSIC',
};

export async function getSpecialFolder(folder: string): Promise<string> {
  if (!VALID_SPECIAL_FOLDERS.has(folder)) {
    throw new Error(`Invalid folder '${folder}'. Valid values: ${[...VALID_SPECIAL_FOLDERS].join(', ')}`);
  }

  if (platform() === 'win32') {
    const { stdout } = await execAsync(`powershell -Command "[Environment]::GetFolderPath('${folder}')"`);
    return stdout.trim();
  }

  const xdgName = XDG_FOLDER_MAP[folder];
  if (!xdgName) {
    throw new Error(`Folder '${folder}' is not supported on non-Windows platforms`);
  }

  try {
    const { stdout } = await execAsync(`xdg-user-dir ${xdgName}`);
    return stdout.trim();
  } catch {
    const fallbackMap: Record<string, string> = {
      Desktop: 'Desktop',
      MyDocuments: 'Documents',
      MyPictures: 'Pictures',
      MyMusic: 'Music',
    };
    return `${userInfo().homedir}/${fallbackMap[folder]}`;
  }
}
