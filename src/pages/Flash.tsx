import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, CircleAlert, FileCode, Upload, Zap } from 'lucide-react';
import { fromByteArray, toByteArray } from 'base64-js';
import { useHubStore } from '@/stores/hubStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { useIsViewer } from '@/stores/authStore';
import { toast } from '@/stores/uiStore';
import { commandService } from '@/services/commandService';
import sketches from '@/config/arduino-sketches.json';
import { BINARY_FORMATS, BOARDS, findBoard, flasherFor, formatFromFileName, hubFlashFormats } from '@/config/boards';
import { useOpenTerminal } from '@/hooks/useDeviceActions';
import { clock, deviceKey, duration, msSince, plural } from '@/lib/format';
import { useNow } from '@/hooks/useTicker';
import { deviceName } from '@/lib/devices';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/primitives';
import { FirmwareEditor } from '@/components/flash/FirmwareEditor';
import type { ArtifactFormat, BoardProfileInfo, Task } from '@/types';

interface SketchPreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

type Firmware =
  | { kind: 'text'; format: 'ino' | 'hex'; content: string; source: string }
  | { kind: 'binary'; format: 'bin' | 'elf'; bytes: Uint8Array; source: string };

const PRESETS = (sketches as { presets: SketchPreset[] }).presets;
const DETECTED = 'detected';

// Intel HEX: every non-empty line is ':' followed by hex digits (same check as the hub)
const isIntelHex = (text: string): boolean => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^:[0-9A-Fa-f]{10,}$/.test(line.trim()));
};

const textFirmware = (content: string, source: string): Firmware => ({ kind: 'text', format: isIntelHex(content) ? 'hex' : 'ino', content, source });

const firmwareBase64 = (fw: Firmware): string => fromByteArray(fw.kind === 'binary' ? fw.bytes : new TextEncoder().encode(fw.content));

/** Numbered step in the flash plan: a white check once done. */
function Step({ n, done, last, success, title, children }: { n: number; done: boolean; last?: boolean; success?: boolean; title: string; children: ReactNode }) {
  return (
    <div className={cn('grid grid-cols-[24px_minmax(0,1fr)] gap-3.5 px-5', last && 'pb-5')}>
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-[3px] text-xs font-extrabold',
            done ? (success ? 'bg-ok text-black' : 'bg-fg text-black') : 'bg-line'
          )}
        >
          {done ? <Check size={14} strokeWidth={3} /> : n}
        </span>
        {!last && <span className="mt-1.5 w-0.5 flex-1 bg-line" />}
      </div>
      <div className={cn('min-w-0', !last && 'pb-5')}>
        <div className="text-base leading-6 font-bold">{title}</div>
        {children}
      </div>
    </div>
  );
}

function TimelineRow({ label, time, state }: { label: string; time?: string; state: 'done' | 'active' | 'todo' | 'failed' }) {
  return (
    <div className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-3 py-1.5">
      <span
        className={cn(
          'size-2.5 rounded-full border-2',
          state === 'done' && 'border-fg bg-fg',
          state === 'active' && 'border-fg',
          state === 'todo' && 'border-[#3A3A3A]',
          state === 'failed' && 'border-brand-ink bg-brand-ink'
        )}
      />
      <span className={cn('text-sm', state === 'todo' ? 'text-fg-3' : state === 'failed' ? 'text-brand-ink' : 'text-fg', state === 'active' ? 'font-bold' : 'font-medium')}>
        {label}
      </span>
      <span className="font-mono text-xs text-fg-3">{time ?? ''}</span>
    </div>
  );
}

function FlashProgress({ task, firmware, board, hubId, portPath }: { task: Task; firmware: Firmware | null; board?: BoardProfileInfo; hubId: string; portPath: string }) {
  const now = useNow(1000);
  const ino = firmware?.format === 'ino';
  const openocd = flasherFor(board) === 'openocd';
  const name = board?.name ?? 'board';
  const { status } = task;
  const failed = status === 'failed' || status === 'cancelled';

  // Pending and running read the same: hubs only report a task when it is queued and when it ends
  const headline =
    status === 'completed' ? (
      'Flash complete'
    ) : failed ? (
      status === 'cancelled' ? 'Flash cancelled' : 'Flash failed'
    ) : ino ? (
      <>
        Compiling and flashing on <span className="whitespace-nowrap">{hubId}</span>…
      </>
    ) : (
      `Flashing ${name}…`
    );

  const detail =
    status === 'completed'
      ? `${name} on ${portPath} is running ${firmware?.source ?? 'the new firmware'}.`
      : status === 'pending'
        ? `Sent ${duration(msSince(task.created_at, now) ?? 0)} ago. The hub reports back when the flash finishes${
            ino && openocd ? '; STM32 compiles can take several minutes' : ''
          }.`
        : failed
          ? (task.error ?? 'The hub reported an error.')
          : ino
            ? `arduino-cli · ${board?.fqbn ?? 'board'}${openocd ? ', then OpenOCD over ST-LINK. STM32 builds can take several minutes.' : `, then upload over ${portPath}.`}`
            : openocd
              ? `OpenOCD over ST-LINK: write .${firmware?.format}, verify, reset.`
              : `Uploading .${firmware?.format} over ${portPath}.`;

  const progress = task.progress;
  // Hubs do not report "running" yet (see .claude/ui-overhaul.md), so pending animates too
  const bar = status === 'completed' || failed ? 100 : progress != null ? Math.max(8, Math.min(100, progress)) : null;

  const writeLabel = ino ? 'Compile and write' : 'Write firmware';
  return (
    <div className="mt-2">
      <div className="text-[22px] leading-7 font-extrabold tracking-[-0.02em]">{headline}</div>
      <div className={cn('mt-1 text-[13px] leading-[18px] [overflow-wrap:anywhere]', failed ? 'text-brand-ink' : 'text-fg-2')}>{detail}</div>
      <div className="relative mt-3.5 h-1 overflow-hidden rounded-full bg-line">
        {bar == null ? (
          <div className="absolute inset-y-0 w-2/5 animate-indeterminate rounded-full bg-fg" />
        ) : (
          <div
            className={cn('h-full rounded-full transition-[width] duration-700', status === 'completed' ? 'bg-ok' : failed ? 'bg-brand-ink' : 'bg-fg')}
            style={{ width: `${bar}%` }}
          />
        )}
      </div>
      <div className="mt-3.5 flex flex-col">
        <TimelineRow label="Sent to hub" time={clock(task.created_at)} state="done" />
        <TimelineRow
          label={writeLabel}
          time={task.started_at ? clock(task.started_at) : undefined}
          state={status === 'running' || status === 'pending' ? 'active' : status === 'completed' ? 'done' : failed ? 'failed' : 'todo'}
        />
        <TimelineRow
          label={failed ? (status === 'cancelled' ? 'Cancelled' : 'Failed') : 'Board restarted'}
          time={task.completed_at ? clock(task.completed_at) : undefined}
          state={status === 'completed' ? 'done' : failed ? 'failed' : 'todo'}
        />
      </div>
    </div>
  );
}

export function Flash() {
  const [params, setParams] = useSearchParams();
  const hubId = params.get('hub') ?? '';
  const portId = params.get('port') ?? '';

  const hubs = useHubStore((s) => s.hubs);
  const tasks = useHubStore((s) => s.tasks);
  const devices = useDeviceStore((s) => s.byHub[hubId]);
  const refreshDevices = useDeviceStore((s) => s.refresh);
  const viewer = useIsViewer();
  const openTerminal = useOpenTerminal();

  const [sketchId, setSketchId] = useState('');
  const [firmware, setFirmware] = useState<Firmware | null>(null);
  const [boardId, setBoardId] = useState(DETECTED);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const setTarget = (hub: string, port: string) => {
    const next = new URLSearchParams();
    if (hub) next.set('hub', hub);
    if (port) next.set('port', port);
    setParams(next, { replace: true });
    setBoardId(DETECTED);
    setTaskId(null);
  };

  const hub = hubs.find((h) => h.hubId === hubId);
  const ports = hub?.connected ? (devices?.ports ?? []) : [];
  const port = ports.find((p) => p.port_id === portId);
  const detected = port?.board_profile ?? undefined;
  const board = boardId === DETECTED ? detected : findBoard(boardId);
  const flasher = flasherFor(board);

  const hubFormats = hubFlashFormats(hub?.capabilities);
  const boardFormats = board?.artifacts?.length ? (board.artifacts as ArtifactFormat[]) : hubFormats;
  const allowed = hubFormats.filter((f) => boardFormats.includes(f));

  const problem = (() => {
    if (!firmware) return null;
    if (!allowed.includes(firmware.format)) {
      return `${board ? board.name : 'This hub'} cannot flash .${firmware.format} files (accepts ${allowed.map((f) => `.${f}`).join(', ') || 'none'}).`;
    }
    if (firmware.format === 'ino' && !board?.fqbn) return 'Select the board type so the sketch can be compiled.';
    return null;
  })();

  const task = tasks.find((t) => t.task_id === taskId);
  const flashing = !!task && (task.status === 'pending' || task.status === 'running');
  const targetOk = !!(hub?.connected && port);
  const canFlash = targetOk && !!firmware && !problem && !viewer && !flashing && !sending;
  const lines = firmware?.kind === 'text' ? firmware.content.split('\n').length : 0;
  const boardLabel = board?.name ?? (port ? deviceName(port) : 'firmware');

  const loadPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setSketchId(id);
    setFirmware({ kind: 'text', format: 'ino', content: new TextDecoder().decode(toByteArray(preset.content)), source: preset.name });
    setTaskId(null);
  };

  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const format = formatFromFileName(file.name);
    if (!format) {
      toast('Unsupported file type. Upload .ino source, or a compiled .hex, .bin or .elf image.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (BINARY_FORMATS.has(format)) {
        setFirmware({ kind: 'binary', format: format as 'bin' | 'elf', bytes: new Uint8Array(reader.result as ArrayBuffer), source: file.name });
      } else {
        const content = String(reader.result ?? '').replace(/\r\n/g, '\n');
        if (format === 'hex' && !isIntelHex(content)) {
          toast('This file does not look like valid Intel HEX.', 'error');
          return;
        }
        setFirmware({ kind: 'text', format: format as 'ino' | 'hex', content, source: file.name });
      }
      setSketchId('');
      setTaskId(null);
    };
    if (BINARY_FORMATS.has(format)) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  const flash = async () => {
    if (!canFlash || !firmware) return;
    setSending(true);
    const result = await commandService.flash(
      hubId,
      portId,
      {
        firmwareData: firmwareBase64(firmware),
        artifactFormat: firmware.format,
        boardFqbn: board?.fqbn ?? undefined,
        boardProfile: boardId === DETECTED ? undefined : boardId,
      },
      { showSuccessToast: false, showErrorToast: false }
    );
    setSending(false);
    if (result.success) setTaskId(result.taskId);
    else toast(`Could not start flashing: ${result.error ?? 'unknown error'}`, 'error');
  };

  const ctaNote = viewer
    ? 'View-only mode does not allow flashing.'
    : !targetOk
      ? 'Choose a target first.'
      : !firmware
        ? 'Load firmware to continue.'
        : problem
          ? 'Fix the firmware issue above.'
          : firmware.format === 'ino'
            ? `Compiles on ${hubId} with arduino-cli, then flashes${flasher === 'openocd' ? ' with OpenOCD' : ''}.`
            : flasher === 'openocd'
              ? 'Programs the image over ST-LINK with OpenOCD, then verifies and resets.'
              : 'Flashes the image as-is.';

  return (
    <section className="flex flex-col gap-7">
      <PageHeader title="Flash firmware" subtitle="Arduino Uno R3, Mega, Nano, Uno R4 and STM32 boards, flashed through the hub they're plugged into." />

      <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6 max-xl:grid-cols-1">
        {/* Firmware editor */}
        <div className="min-w-0 overflow-hidden rounded-[4px] border border-edge bg-panel">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line-panel px-3.5 py-3">
            <Select
              aria-label="Load a preset sketch"
              value={sketchId}
              onChange={(e) => loadPreset(e.target.value)}
              wrapperClassName="min-w-[220px]"
              className="h-9 bg-control font-semibold"
            >
              <option value="">Load a preset sketch…</option>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[4px] bg-control px-3.5 text-sm font-semibold hover:bg-control-hover focus-within:outline-2 focus-within:outline-fg">
              <Upload size={14} />
              Upload file
              <input type="file" accept=".ino,.hex,.bin,.elf" onChange={upload} className="sr-only" />
            </label>
            <span className="flex-1" />
            <span className="font-mono text-xs text-fg-3">
              {!firmware
                ? 'Empty'
                : firmware.kind === 'binary'
                  ? `.${firmware.format} · ${firmware.bytes.length.toLocaleString()} bytes`
                  : `${plural(lines, 'line')} · ${firmware.content.length.toLocaleString()} characters · .${firmware.format}`}
            </span>
          </div>
          {firmware?.kind === 'binary' && (
            <div className="flex items-center gap-2.5 border-b border-line-panel bg-[#141414] px-4 py-3 text-[13px] text-fg-2">
              <FileCode size={16} className="shrink-0" />
              <span>{firmware.source} is a binary image; it is flashed as-is. Type or load a sketch in the editor to replace it.</span>
            </div>
          )}
          <div className="h-[488px] bg-editor">
            <FirmwareEditor
              value={firmware?.kind === 'text' ? firmware.content : ''}
              onChange={(text) => {
                setFirmware(text.trim() ? textFirmware(text, 'Editor') : null);
                setSketchId('');
                setTaskId(null);
              }}
            />
          </div>
        </div>

        {/* Flash plan */}
        <div className="rounded-[4px] border border-edge bg-panel xl:sticky xl:top-24">
          <div className="kicker px-5 pt-[18px] pb-1.5">Flash plan</div>

          <div className="pt-3">
            <Step n={1} done={targetOk} title="Target">
              <div className="mt-2.5 flex flex-col gap-2.5">
                <Field label={<span className="text-xs text-fg-3">Hub</span>}>
                  <Select value={hubId} onChange={(e) => setTarget(e.target.value, '')}>
                    <option value="">Select hub…</option>
                    {hubs
                      .filter((h) => h.connected || h.hubId === hubId)
                      .map((h) => (
                        <option key={h.hubId} value={h.hubId} disabled={!h.connected}>
                          {h.hubId}
                          {h.connected ? '' : ' (offline)'}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={<span className="text-xs text-fg-3">Port</span>}>
                  <Select value={portId} onChange={(e) => setTarget(hubId, e.target.value)} disabled={!hub?.connected}>
                    <option value="">{hub ? (ports.length ? 'Select port…' : 'No devices on this hub') : 'Select a hub first'}</option>
                    {ports.map((p) => (
                      <option key={p.port_id} value={p.port_id}>
                        {deviceName(p)} · {p.port}
                      </option>
                    ))}
                    {portId && !port && <option value={portId}>{portId} (not reported)</option>}
                  </Select>
                </Field>
                <Field label={<span className="text-xs text-fg-3">Board</span>}>
                  <Select
                    value={boardId}
                    onChange={(e) => {
                      setBoardId(e.target.value);
                      setTaskId(null);
                    }}
                  >
                    <option value={DETECTED}>{detected ? `Detected: ${detected.name}` : 'Detected by hub (unknown)'}</option>
                    {BOARDS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="font-mono text-xs leading-[18px] text-fg-3">
                  {targetOk ? (
                    <>
                      <div>
                        Accepts {allowed.map((f) => `.${f}`).join(' ') || 'nothing on this hub'}
                        {hub && !hub.profile && ' · older hub software'}
                      </div>
                      {flasher && <div>Flashed with {flasher === 'openocd' ? <span className="whitespace-nowrap">OpenOCD over ST-LINK</span> : 'arduino-cli'}</div>}
                    </>
                  ) : (
                    'Pick the hub and port the board is plugged into.'
                  )}
                </div>
              </div>
            </Step>

            <Step n={2} done={!!firmware && !problem} title="Firmware">
              <div className="mt-1 text-sm text-fg-2">
                {firmware
                  ? `${firmware.source} · .${firmware.format} · ${firmware.kind === 'binary' ? `${firmware.bytes.length.toLocaleString()} bytes` : plural(lines, 'line')}`
                  : 'Load a preset, upload a file or type in the editor.'}
              </div>
              {problem && (
                <div className="mt-2.5 flex gap-2 rounded-[4px] bg-warn/10 px-3 py-2.5 text-[13px] leading-[18px] text-warn">
                  <CircleAlert size={16} className="mt-px shrink-0" />
                  <span>{problem}</span>
                </div>
              )}
            </Step>

            <Step n={3} done={task?.status === 'completed'} success last title="Flash">
              {!task ? (
                <>
                  <Button variant="primary" className="mt-3 h-14 w-full text-base" disabled={!canFlash} onClick={() => void flash()}>
                    <Zap size={18} />
                    {viewer ? 'Flashing disabled' : sending ? 'Sending…' : targetOk ? `Flash ${boardLabel}` : 'Flash firmware'}
                  </Button>
                  <div className="mt-2 text-xs leading-[18px] text-fg-3">{ctaNote}</div>
                </>
              ) : (
                <>
                  <FlashProgress task={task} firmware={firmware} board={board} hubId={hubId} portPath={port?.port ?? 'serial'} />
                  {!flashing && (
                    <div className="mt-3.5 flex gap-2">
                      <Button size="md" className="h-11 flex-1" onClick={() => setTaskId(null)}>
                        {task.status === 'completed' ? 'Flash again' : 'Try again'}
                      </Button>
                      {task.status === 'completed' && (
                        <Button variant="light" size="md" className="h-11 flex-1" onClick={() => openTerminal(deviceKey(hubId, portId))}>
                          Open terminal
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </Step>
          </div>

          <details className="border-t border-line-panel px-5 py-3.5">
            <summary className="cursor-pointer text-[13px] font-semibold text-fg-2">Flashing notes</summary>
            <ul className="mt-2.5 flex list-disc flex-col gap-1.5 pl-[18px] text-[13px] leading-[19px] text-fg-2">
              <li>.ino sketches are compiled on the hub with arduino-cli; the board type decides how.</li>
              <li>Precompiled images flash faster: .hex for AVR boards, .bin for the Uno R4, .bin/.elf/.hex for STM32.</li>
              <li>STM32 boards are programmed through the on-board ST-LINK with OpenOCD (write, verify, reset).</li>
              <li>Compiling for STM32 on a Pi can take several minutes the first time.</li>
              <li>Flash hangs? Unplug and re-plug the board, then try again.</li>
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}
