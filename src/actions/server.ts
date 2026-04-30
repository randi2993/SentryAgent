import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function restartIIS(): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync('iisreset');
    if (stderr) {
      console.log(`IIS Reset output: ${stderr}`);
    }
    return stdout.trim() || 'IIS restarted successfully.';
  } catch (error) {
    throw new Error(`Failed to restart IIS: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function restartNodeRed(): Promise<string> {
  try {
    // Assuming Node-RED is running as a Windows service named "Node-RED"
    // Modify the service name if it differs in this specific environment
    const { stdout, stderr } = await execAsync('net stop "Node-RED" && net start "Node-RED"');
    if (stderr) {
      console.log(`Node-RED Restart output: ${stderr}`);
    }
    return stdout.trim() || 'Node-RED restarted successfully.';
  } catch (error) {
    throw new Error(`Failed to restart Node-RED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getServiceStatus(name: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`sc query "${name}"`);
    if (stderr) {
      console.log(`Service Query output: ${stderr}`);
    }
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to get service status for ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
