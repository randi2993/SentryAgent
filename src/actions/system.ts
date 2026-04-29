import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function execCommand(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) {
      console.error(`Command execution warning/error output: ${stderr}`);
    }
    return stdout.trim() || 'Command executed successfully with no output.';
  } catch (error) {
    throw new Error(`Failed to execute command: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function unlockLaptop(): Promise<string> {
  try {
    // Unlocking a Windows session programmatically from a background service requires a specific setup.
    // A common workaround is to use `tscon` to hijack the console session or use a third-party tool like NirCmd.
    // Since environments vary wildly, this throws until configured with the exact local command.
    throw new Error('Unlock laptop command requires a specific script or tool path defined for this environment.');
  } catch (error) {
    throw new Error(`Failed to unlock laptop: ${error instanceof Error ? error.message : String(error)}`);
  }
}
