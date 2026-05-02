import { hubsApi } from './api';
import type { TaskStatusResponse, Task } from '../types';
import { useHubStore } from '../stores/hubStore';

// Command types supported by the service
export type CommandType = 'restart' | 'serial_write' | 'flash' | 'close';

// Command parameters for each command type
export interface RestartCommandParams {
  priority?: number;
}

export interface SerialWriteCommandParams {
  data: string;
  priority?: number;
}

export interface FlashCommandParams {
  firmwareData: string;
  boardFqbn?: string;
  priority?: number;
}

export interface CloseCommandParams {
  priority?: number;
}

export type CommandParams =
  | RestartCommandParams
  | SerialWriteCommandParams
  | FlashCommandParams
  | CloseCommandParams;

// Command execution options
export interface CommandOptions {
  hubId: string;
  portId: string;
  commandType: CommandType;
  params?: CommandParams;
  timeoutMs?: number; // Default: 30000
  showSuccessToast?: boolean; // Default: true
  showErrorToast?: boolean; // Default: true
}

// Command result
export interface CommandResult {
  success: boolean;
  taskId: string;
  response?: TaskStatusResponse;
  error?: string;
  timedOut?: boolean;
}

/**
 * Centralized command service for executing device commands (restart, serial write, flash, etc.)
 * Features:
 * - Unified interface for all command types
 * - Automatic task tracking in hubStore
 * - 30-second timeout with auto-cleanup
 * - Toast notifications for success/error
 * - Prevents duplicate commands for same device
 */
class CommandService {
  private readonly DEFAULT_TIMEOUT_MS = 30000;

  private async buildCloseCommandResponse(
    hubId: string,
    portId: string,
    priority?: number
  ): Promise<TaskStatusResponse> {
    const closeResponse = await hubsApi.closeConnection(hubId, portId, priority);

    return {
      task_id: closeResponse.commandId,
      command_type: 'close',
      status: closeResponse.status,
      priority: priority ?? 1,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Execute a command on a device
   */
  async executeCommand(options: CommandOptions): Promise<CommandResult> {
    const {
      hubId,
      portId,
      commandType,
      params = {},
      timeoutMs = this.DEFAULT_TIMEOUT_MS,
      showSuccessToast = true,
      showErrorToast = true,
    } = options;

    // Check if command is already running for this device
    const existingTask = useHubStore.getState().getActiveTaskForPort(portId);
    if (existingTask) {
      const error = `Command already in progress for this device`;
      if (showErrorToast) {
        console.error(error);
      }
      return {
        success: false,
        taskId: existingTask.task_id,
        error,
      };
    }

    try {
      // Send command to backend
      let response: TaskStatusResponse;

      switch (commandType) {
        case 'restart':
          response = await hubsApi.sendRestartCommand(
            hubId,
            portId,
            (params as RestartCommandParams).priority
          );
          break;

        case 'serial_write':
          response = await hubsApi.sendSerialWrite(
            hubId,
            portId,
            (params as SerialWriteCommandParams).data,
            (params as SerialWriteCommandParams).priority
          );
          break;

        case 'flash':
          response = await hubsApi.sendFlashCommand(
            hubId,
            portId,
            (params as FlashCommandParams).firmwareData,
            (params as FlashCommandParams).priority,
            (params as FlashCommandParams).boardFqbn
          );
          break;

        case 'close':
          response = await this.buildCloseCommandResponse(
            hubId,
            portId,
            (params as CloseCommandParams).priority
          );
          break;

        default:
          throw new Error(`Unsupported command type: ${commandType}`);
      }

      // Track task in store
      useHubStore.getState().addTask({
        task_id: response.task_id,
        command_type: response.command_type,
        status: response.status as Task['status'],
        priority: response.priority,
        port_id: portId,
        hub_id: hubId,
        created_at: response.created_at,
      });

      // Set timeout for auto-cleanup
      this.scheduleTaskTimeout(response.task_id, timeoutMs);

      // Log success for command sent
      if (showSuccessToast) {
        console.log(`${this.getCommandLabel(commandType)} command sent`);
      }

      return {
        success: true,
        taskId: response.task_id,
        response,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (showErrorToast) {
        console.error(`Failed to send ${this.getCommandLabel(commandType)}: ${errorMessage}`);
      }

      return {
        success: false,
        taskId: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Restart a device
   */
  async restart(
    hubId: string,
    portId: string,
    priority?: number,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({
      hubId,
      portId,
      commandType: 'restart',
      params: { priority },
      ...options,
    });
  }

  /**
   * Send serial data to a device
   */
  async serialWrite(
    hubId: string,
    portId: string,
    data: string,
    priority?: number,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({
      hubId,
      portId,
      commandType: 'serial_write',
      params: { data, priority },
      ...options,
    });
  }

  /**
   * Flash firmware to a device
   */
  async flash(
    hubId: string,
    portId: string,
    firmwareData: string,
    boardFqbn?: string,
    priority?: number,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({
      hubId,
      portId,
      commandType: 'flash',
      params: { firmwareData, boardFqbn, priority },
      ...options,
    });
  }

  /**
   * Close a device connection
   */
  async close(
    hubId: string,
    portId: string,
    priority?: number,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({
      hubId,
      portId,
      commandType: 'close',
      params: { priority },
      ...options,
    });
  }

  /**
   * Schedule automatic task cleanup after timeout
   */
  private scheduleTaskTimeout(taskId: string, timeoutMs: number): void {
    setTimeout(() => {
      const task = useHubStore.getState().tasks.find((t) => t.task_id === taskId);
      
      // Only timeout if task is still pending or running
      if (task && (task.status === 'pending' || task.status === 'running')) {
        useHubStore.getState().updateTaskStatus({
          task_id: taskId,
          status: 'failed',
          error: 'Command timeout - no response received',
        });
        
        console.error(`${this.getCommandLabel(task.command_type)} timed out after ${timeoutMs / 1000}s`);
      }
    }, timeoutMs);
  }

  /**
   * Get human-readable label for command type
   */
  private getCommandLabel(commandType: string): string {
    const labels: Record<string, string> = {
      restart: 'Restart',
      serial_write: 'Serial Write',
      flash: 'Flash',
      close: 'Close Connection',
    };
    return labels[commandType] || commandType;
  }
}

// Export singleton instance
export const commandService = new CommandService();
