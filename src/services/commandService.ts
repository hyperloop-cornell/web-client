import { hubsApi, type FlashCommandPayload } from './api';
import { toTaskState, type TaskStatusResponse } from '../types';
import { useHubStore } from '../stores/hubStore';

// Command types supported by the service
export type CommandType = 'restart' | 'serial_write' | 'flash' | 'close';

export interface RestartCommandParams {
  priority?: number;
}

export interface SerialWriteCommandParams {
  data: string;
  priority?: number;
}

export type FlashCommandParams = FlashCommandPayload;

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
  timeoutMs?: number; // Default depends on the command (see DEFAULT_TIMEOUT_MS)
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
 * How long the GUI waits for a final task status before marking a command failed. Flashing
 * includes compiling on the hub: STM32 builds on a Pi can take several minutes (the hub allows
 * up to 15 minutes, see rpi-hub-server config/boards.yaml compile_timeout).
 */
const DEFAULT_TIMEOUT_MS: Record<CommandType, number> = {
  serial_write: 30_000,
  restart: 45_000,
  close: 30_000,
  flash: 17 * 60_000,
};

function errorDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const data = (error as { response?: { data?: { detail?: unknown } } }).response?.data;
    if (typeof data?.detail === 'string') return data.detail;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Centralized command service for executing device commands (restart, serial write, flash, etc.)
 * Features:
 * - Unified interface for all command types
 * - Automatic task tracking in hubStore (final status arrives over the WebSocket)
 * - Per-command timeout with auto-cleanup
 * - Prevents duplicate commands for same device
 */
class CommandService {
  /**
   * Execute a command on a device
   */
  async executeCommand(options: CommandOptions): Promise<CommandResult> {
    const {
      hubId,
      portId,
      commandType,
      params = {},
      timeoutMs = DEFAULT_TIMEOUT_MS[commandType],
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
      let response: TaskStatusResponse;

      switch (commandType) {
        case 'restart':
          response = await hubsApi.sendRestartCommand(hubId, portId, (params as RestartCommandParams).priority);
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
          response = await hubsApi.sendFlashCommand(hubId, portId, params as FlashCommandParams);
          break;

        case 'close':
          response = await hubsApi.closeConnection(hubId, portId, (params as CloseCommandParams).priority);
          break;

        default:
          throw new Error(`Unsupported command type: ${commandType}`);
      }

      const store = useHubStore.getState();
      store.addTask({
        task_id: response.task_id,
        command_type: response.command_type ?? commandType,
        status: toTaskState(response.status),
        priority: response.priority ?? 5,
        port_id: portId,
        hub_id: hubId,
        created_at: response.created_at ?? response.timestamp,
      });

      this.scheduleTaskTimeout(response.task_id, timeoutMs);

      if (showSuccessToast) {
        console.log(`${this.getCommandLabel(commandType)} command sent`);
      }

      return {
        success: true,
        taskId: response.task_id,
        response,
      };
    } catch (error) {
      const errorMessage = errorDetail(error);

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

  async restart(
    hubId: string,
    portId: string,
    priority?: number,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({ hubId, portId, commandType: 'restart', params: { priority }, ...options });
  }

  async serialWrite(
    hubId: string,
    portId: string,
    data: string,
    priority?: number,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({ hubId, portId, commandType: 'serial_write', params: { data, priority }, ...options });
  }

  async flash(
    hubId: string,
    portId: string,
    payload: FlashCommandPayload,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({ hubId, portId, commandType: 'flash', params: payload, ...options });
  }

  async close(
    hubId: string,
    portId: string,
    priority?: number,
    options?: { showSuccessToast?: boolean; showErrorToast?: boolean }
  ): Promise<CommandResult> {
    return this.executeCommand({ hubId, portId, commandType: 'close', params: { priority }, ...options });
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

  private getCommandLabel(commandType: string): string {
    const labels: Record<string, string> = {
      restart: 'Restart',
      serial_write: 'Serial Write',
      flash: 'Flash',
      close: 'Close Connection',
      close_connection: 'Close Connection',
    };
    return labels[commandType] || commandType;
  }
}

// Export singleton instance
export const commandService = new CommandService();
