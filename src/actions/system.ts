import { exec } from 'child_process';
import { promisify } from 'util';

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
