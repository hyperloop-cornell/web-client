import { useState } from 'react';
import { LoaderCircle, RotateCw, Send } from 'lucide-react';
import { useHubStore } from '@/stores/hubStore';
import { connectionFor, useDeviceStore } from '@/stores/deviceStore';
import { useTelemetryStore, type SentLine } from '@/stores/telemetryStore';
import { toast } from '@/stores/uiStore';
import { commandService } from '@/services/commandService';
import { unsubscribeDevice } from '@/services/subscriptions';
import { restartDevice, usePortCommandState } from '@/hooks/useDeviceActions';
import { clock, splitKey } from '@/lib/format';
import { deviceName } from '@/lib/devices';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/overlay';
import type { Task } from '@/types';

/** Lines shown; the store keeps more. */
const VISIBLE_LINES = 200;

const EMPTY_LINES: never[] = [];

function sentStatus(line: SentLine, task: Task | undefined): string {
  if (!line.taskId) return `failed: ${line.error ?? 'not sent'}`;
  if (!task) return 'sent';
  if (task.status === 'pending') return 'queued';
  if (task.status === 'running') return 'sending';
  if (task.status === 'completed') return 'sent';
  return `failed: ${task.error ?? task.status}`;
}

export function TerminalSheet({ deviceKey, onClose }: { deviceKey: string; onClose: () => void }) {
  const { hubId, portId } = splitKey(deviceKey);
  const [input, setInput] = useState('');
  const port = useDeviceStore((s) => s.byHub[hubId]?.ports.find((p) => p.port_id === portId));
  const conn = useDeviceStore((s) => connectionFor(s.byHub[hubId], portId));
  const lines = useTelemetryStore((s) => s.devices.get(deviceKey)?.lines ?? EMPTY_LINES);
  const sensor = useTelemetryStore((s) => s.detectedSensors.get(deviceKey));
  const sent = useTelemetryStore((s) => s.sent[deviceKey] ?? EMPTY_LINES);
  const recordSent = useTelemetryStore((s) => s.recordSent);
  const tasks = useHubStore((s) => s.tasks);
  const { busy, viewer, restartTitle } = usePortCommandState(portId);

  const canSend = !viewer && input.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    const text = input;
    setInput('');
    const result = await commandService.serialWrite(hubId, portId, text, undefined, { showSuccessToast: false, showErrorToast: false });
    recordSent(deviceKey, { ts: Date.now(), text, taskId: result.success ? result.taskId : null, error: result.error });
    if (!result.success) toast(`Could not send: ${result.error ?? 'unknown error'}`, 'error');
  };

  // Newest first: the list is rendered column-reverse so it stays pinned to the bottom
  const rows = [
    ...lines.slice(-VISIBLE_LINES).map((l, i) => ({ key: `r${l.ts}-${i}`, ts: l.ts, text: l.text, sent: false })),
    ...sent.map((s, i) => ({
      key: `s${s.ts}-${i}`,
      ts: s.ts,
      text: `→ ${s.text}   ${sentStatus(s, tasks.find((t) => t.task_id === s.taskId))}`,
      sent: true,
    })),
  ].sort((a, b) => b.ts - a.ts);

  const title = sensor ?? (port ? deviceName(port) : portId);
  const meta = [hubId, port?.port ?? portId, conn ? `${conn.baud_rate} baud` : null].filter(Boolean).join(' · ');

  return (
    <Sheet
      open
      onClose={onClose}
      width={640}
      kicker="Serial terminal"
      title={<span className="text-[26px] leading-[30px] tracking-[-0.02em]">{title}</span>}
      meta={<span className="font-mono text-xs text-fg-3">{meta}</span>}
      actions={
        <>
          <Button size="sm" onClick={() => void restartDevice(hubId, portId)} disabled={viewer || busy} title={restartTitle} className="max-sm:hidden">
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCw size={14} />}
            {busy ? 'Restarting…' : 'Restart'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              unsubscribeDevice(hubId, portId);
              onClose();
            }}
          >
            Unsubscribe
          </Button>
        </>
      }
    >
      <div
        role="log"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-ink px-7 py-3.5 font-mono text-[12.5px] leading-[19px] max-sm:px-4"
      >
        {rows.map((r) => (
          <div key={r.key} className="flex gap-3.5 whitespace-pre-wrap">
            <span className="shrink-0 text-fg-4">{clock(r.ts)}</span>
            <span className={r.sent ? 'text-fg' : 'text-[#CFCFCF]'}>{r.text}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="text-fg-4">Waiting for the first line…</div>}
      </div>

      <form
        className="flex gap-2.5 border-t border-edge px-7 pt-4 pb-5 max-sm:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={viewer}
          data-autofocus
          aria-label="Data to send"
          placeholder={viewer ? 'View-only mode cannot send data' : `Send to ${port?.port ?? portId}`}
          className="h-12 min-w-0 flex-1 rounded-[4px] border-2 border-transparent bg-field px-3.5 font-mono text-[13px] outline-none focus:border-fg disabled:cursor-not-allowed"
        />
        <Button type="submit" variant="primary" size="lg" disabled={!canSend}>
          <Send size={16} />
          Send
        </Button>
      </form>
    </Sheet>
  );
}
