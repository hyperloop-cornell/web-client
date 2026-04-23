import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCw, Send, Zap, XCircle } from 'lucide-react';
import { commandService } from '@/services/commandService';
import type { CommandType, CommandParams } from '@/services/commandService';
import { useHubStore } from '@/stores/hubStore';

interface CommandButtonProps {
  hubId: string;
  portId: string;
  commandType: CommandType;
  params?: CommandParams;
  priority?: number;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  showLabel?: boolean;
  disabled?: boolean;
}

const COMMAND_ICONS: Record<CommandType, React.ComponentType<{ className?: string }>> = {
  restart: RotateCw,
  serial_write: Send,
  flash: Zap,
  close: XCircle,
};

const COMMAND_LABELS: Record<CommandType, string> = {
  restart: 'Restart',
  serial_write: 'Send',
  flash: 'Flash',
  close: 'Close',
};

export function CommandButton({
  hubId,
  portId,
  commandType,
  params,
  label,
  variant = 'outline',
  size = 'sm',
  className = '',
  showLabel = false,
  disabled = false,
}: CommandButtonProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const activeTask = useHubStore((state) => state.getActiveTaskForPort(portId));

  const Icon = COMMAND_ICONS[commandType];
  const displayLabel = label || COMMAND_LABELS[commandType];

  const isDisabled = disabled || isExecuting || !!activeTask;
  const isRunning = activeTask?.status === 'running';
  const isPending = activeTask?.status === 'pending';

  const handleClick = async () => {
    if (isDisabled) return;

    setIsExecuting(true);

    try {
      await commandService.executeCommand({
        hubId,
        portId,
        commandType,
        params,
        timeoutMs: 30000,
      });
    } finally {
      // Keep button disabled while task is running
      // setIsExecuting will be cleared when task completes or times out
      setTimeout(() => setIsExecuting(false), 500);
    }
  };

  const getTooltipContent = () => {
    if (isPending) return 'Command queued...';
    if (isRunning) return 'Command executing...';
    if (isExecuting) return 'Sending command...';
    if (activeTask) return 'Command in progress';
    return `${displayLabel} device`;
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleClick}
      disabled={isDisabled}
      title={getTooltipContent()}
    >
      {(isExecuting || isPending) && (
        <Loader2 className="h-4 w-4 animate-spin" />
      )}
      {isRunning && !isExecuting && (
        <Loader2 className="h-4 w-4 animate-spin" />
      )}
      {!isExecuting && !isPending && !isRunning && Icon && (
        <Icon className="h-4 w-4" />
      )}
      {showLabel && <span className="ml-2">{displayLabel}</span>}
    </Button>
  );
}
