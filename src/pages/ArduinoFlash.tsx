import { useState, useEffect, useRef, useMemo } from 'react';
import { useHubStore } from '@/stores/hubStore';
import { useIsViewer } from '@/stores/authStore';
import { hubsApi } from '@/services/api';
import { commandService } from '@/services/commandService';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Loader2, Upload, Play, XCircle } from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { fromByteArray, toByteArray } from 'base64-js';
import sketches from '@/config/arduino-sketches.json';
import { BINARY_FORMATS, BOARDS, findBoard, formatFromFileName, hubFlashFormats } from '@/config/boards';
import type { ArtifactFormat, BoardProfileInfo, PortInfo } from '@/types';

interface SketchPreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

interface SketchesConfig {
  presets: SketchPreset[];
}

type Firmware =
  | { kind: 'text'; format: 'ino' | 'hex'; content: string; source: string }
  | { kind: 'binary'; format: 'bin' | 'elf'; bytes: Uint8Array; source: string };

const sketchConfig = sketches as SketchesConfig;

const DETECTED = 'detected';

// Intel HEX: every non-empty line is ':' followed by hex digits (same check as the hub)
const isIntelHex = (text: string): boolean => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^:[0-9A-Fa-f]{10,}$/.test(line.trim()));
};

function textFirmware(content: string, source: string): Firmware {
  return { kind: 'text', format: isIntelHex(content) ? 'hex' : 'ino', content, source };
}

function firmwareBase64(firmware: Firmware): string {
  return fromByteArray(firmware.kind === 'binary' ? firmware.bytes : new TextEncoder().encode(firmware.content));
}

export function ArduinoFlash() {
  const [selectedSketch, setSelectedSketch] = useState<string>('');
  const [firmware, setFirmware] = useState<Firmware | null>(null);
  const [selectedHub, setSelectedHub] = useState<string>('');
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [selectedBoardId, setSelectedBoardId] = useState<string>(DETECTED);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const applyingExternalChange = useRef(false);

  const { hubs = [], fetchHubs, tasks } = useHubStore();
  const isViewOnly = useIsViewer();

  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  // CodeMirror editor; edits flow back into the firmware state so what you see is what is flashed
  useEffect(() => {
    if (!editorRef.current) return;

    editorViewRef.current = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          cpp(),
          oneDark,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applyingExternalChange.current) return;
            const content = update.state.doc.toString();
            setFirmware(content.trim() ? textFirmware(content, 'Editor') : null);
            setSelectedSketch('');
          }),
        ],
      }),
      parent: editorRef.current,
    });

    return () => {
      editorViewRef.current?.destroy();
    };
  }, []);

  // Show text firmware in the editor (binary images are not editable)
  const editorText = firmware?.kind === 'text' ? firmware.content : '';
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== editorText) {
      applyingExternalChange.current = true;
      view.dispatch({ changes: { from: 0, to: current.length, insert: editorText } });
      applyingExternalChange.current = false;
    }
  }, [editorText]);

  useEffect(() => {
    if (!selectedHub) {
      setPorts([]);
      return;
    }

    const fetchPorts = async () => {
      setIsLoadingPorts(true);
      try {
        setPorts(await hubsApi.getPorts(selectedHub));
        setSelectedPort('');
      } catch (error) {
        console.error('Error fetching ports:', error);
        setPorts([]);
      } finally {
        setIsLoadingPorts(false);
      }
    };

    fetchPorts();
  }, [selectedHub]);

  const hub = hubs.find((h) => h.hubId === selectedHub);
  const port = ports.find((p) => p.port_id === selectedPort);
  const detectedBoard = port?.board_profile ?? undefined;
  const board: BoardProfileInfo | undefined =
    selectedBoardId === DETECTED ? detectedBoard : findBoard(selectedBoardId);

  const hubCapabilities = hub?.capabilities;
  const allowedFormats: ArtifactFormat[] = useMemo(() => {
    const hubFormats = hubFlashFormats(hubCapabilities);
    const boardFormats = board?.artifacts?.length ? (board.artifacts as ArtifactFormat[]) : hubFormats;
    return hubFormats.filter((f) => boardFormats.includes(f));
  }, [board, hubCapabilities]);

  const problem = (() => {
    if (!firmware) return null;
    if (!allowedFormats.includes(firmware.format)) {
      const who = board ? board.name : 'This hub';
      return `${who} cannot flash .${firmware.format} files (accepts ${allowedFormats.map((f) => `.${f}`).join(', ') || 'none'}).`;
    }
    if (firmware.format === 'ino' && !board?.fqbn) {
      return 'Select the board type so the sketch can be compiled.';
    }
    return null;
  })();

  const lastTask = tasks.find((t) => t.task_id === lastTaskId);

  const handleSketchSelect = (sketchId: string) => {
    const sketch = sketchConfig.presets.find((s) => s.id === sketchId);
    if (!sketch) return;
    try {
      const decoded = new TextDecoder().decode(toByteArray(sketch.content));
      setSelectedSketch(sketchId);
      setFirmware({ kind: 'text', format: 'ino', content: decoded, source: sketch.name });
    } catch (error) {
      console.error('Error decoding sketch:', error);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const format = formatFromFileName(file.name);
    if (!format) {
      alert('Unsupported file type. Upload .ino source, or a compiled .hex, .bin or .elf image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (BINARY_FORMATS.has(format)) {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        setFirmware({ kind: 'binary', format: format as 'bin' | 'elf', bytes, source: file.name });
      } else {
        const content = String(reader.result ?? '');
        if (format === 'hex' && !isIntelHex(content)) {
          alert('This file does not look like valid Intel HEX.');
          return;
        }
        setFirmware({ kind: 'text', format: format as 'ino' | 'hex', content, source: file.name });
      }
      setSelectedSketch('');
      setSendError(null);
    };
    if (BINARY_FORMATS.has(format)) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  const handleFlash = async () => {
    if (!selectedHub || !selectedPort || !firmware || problem) return;
    setSendError(null);

    const result = await commandService.flash(
      selectedHub,
      selectedPort,
      {
        firmwareData: firmwareBase64(firmware),
        artifactFormat: firmware.format,
        boardFqbn: board?.fqbn ?? undefined,
        boardProfile: selectedBoardId === DETECTED ? undefined : selectedBoardId,
      },
      { showSuccessToast: false, showErrorToast: false }
    );

    if (result.success) {
      setLastTaskId(result.taskId);
    } else {
      setSendError(result.error ?? 'Failed to start flashing');
    }
  };

  const flashing = lastTask && (lastTask.status === 'pending' || lastTask.status === 'running');

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Firmware Flash</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Flash Arduino (Uno R3, Mega, Nano, Uno R4) and STM32 boards through their hub
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-6">
        {/* Code Editor Panel */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-4">Firmware</h2>

            <div className="mb-4 space-y-2">
              <label className="text-sm font-medium">Load Sketch</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={selectedSketch} onValueChange={handleSketchSelect}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a preset sketch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sketchConfig.presets.map((sketch) => (
                      <SelectItem key={sketch.id} value={sketch.id}>
                        {sketch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <label className="relative">
                  <Button variant="outline" className="gap-2" asChild>
                    <span>
                      <Upload className="h-4 w-4" />
                      Upload File
                    </span>
                  </Button>
                  <input type="file" accept=".ino,.hex,.bin,.elf" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              {firmware && (
                <p className="text-xs text-muted-foreground">
                  Loaded: {firmware.source} (.{firmware.format}
                  {firmware.kind === 'binary' ? `, ${firmware.bytes.length.toLocaleString()} bytes` : ''})
                </p>
              )}
            </div>

            {firmware?.kind === 'binary' && (
              <div className="mb-2 p-3 bg-muted/40 border border-border rounded text-xs text-muted-foreground">
                Binary image loaded; it is flashed as-is. Type or load a sketch in the editor to replace it.
              </div>
            )}

            <div className="border border-border rounded-lg overflow-hidden">
              <div
                ref={editorRef}
                className="h-96 [&_.cm-editor]:h-full [&_.cm-editor]:bg-[#282c34] [&_.cm-editor]:border-none [&_.cm-editor]:rounded-lg [&_.cm-content]:text-[13px] [&_.cm-content]:font-mono [&_.cm-gutters]:bg-[#21252b] [&_.cm-gutters]:border-border [&_.cm-linenumber]:text-[#6b7280] [&_.cm-linenumber]:text-xs [&_.cm-cursor]:border-l-2 [&_.cm-cursor]:border-[#61afef]"
              />
            </div>

            {firmware?.kind === 'text' && (
              <div className="mt-2 text-xs text-muted-foreground">
                {firmware.content.split('\n').length} lines &middot; {firmware.content.length} characters
              </div>
            )}
          </Card>
        </div>

        {/* Control Panel */}
        <div className="space-y-4">
          <Card className="p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-4">Target Device</h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Hub</label>
                <Select value={selectedHub} onValueChange={setSelectedHub}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select hub..." />
                  </SelectTrigger>
                  <SelectContent>
                    {hubs
                      .filter((h) => h.connected)
                      .map((h) => (
                        <SelectItem key={h.hubId} value={h.hubId}>
                          {h.hubId}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Port</label>
                <Select value={selectedPort} onValueChange={setSelectedPort} disabled={isLoadingPorts || !selectedHub}>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoadingPorts ? 'Loading ports...' : 'Select port...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {ports.map((p) => (
                      <SelectItem key={p.port_id} value={p.port_id}>
                        {p.board_profile?.name || p.description || p.port}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Board</label>
                <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DETECTED}>
                      {detectedBoard ? `Detected: ${detectedBoard.name}` : 'Detected by hub (unknown)'}
                    </SelectItem>
                    {BOARDS.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPort && (
                  <p className="text-xs text-muted-foreground">
                    Accepts: {allowedFormats.map((f) => `.${f}`).join(', ') || 'nothing on this hub'}
                    {hub && !hub.profile && ' (older hub software)'}
                  </p>
                )}
              </div>

              {firmware && problem && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-700 dark:text-amber-400 flex gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{problem}</span>
                </div>
              )}
            </div>
          </Card>

          <Button
            onClick={handleFlash}
            disabled={!selectedHub || !selectedPort || !firmware || !!problem || isViewOnly || !!flashing}
            className="w-full gap-2 h-10"
            size="lg"
            title={isViewOnly ? 'View-only mode does not allow flashing' : ''}
          >
            {flashing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isViewOnly ? 'Read-Only Mode' : flashing ? 'Flashing...' : 'Flash'}
          </Button>

          {sendError && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-xs text-destructive flex gap-2">
              <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{sendError}</span>
            </div>
          )}

          {lastTask && (
            <div
              className={`p-3 rounded text-xs flex gap-2 border ${
                lastTask.status === 'completed'
                  ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
                  : lastTask.status === 'failed' || lastTask.status === 'cancelled'
                    ? 'bg-destructive/10 border-destructive/30 text-destructive'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400'
              }`}
            >
              {lastTask.status === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : lastTask.status === 'failed' || lastTask.status === 'cancelled' ? (
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : (
                <Loader2 className="h-4 w-4 mt-0.5 flex-shrink-0 animate-spin" />
              )}
              <span className="break-words">
                {lastTask.status === 'completed' && 'Flash completed.'}
                {lastTask.status === 'pending' && 'Queued on the hub...'}
                {lastTask.status === 'running' &&
                  (firmware?.format === 'ino' ? 'Compiling and flashing on the hub...' : 'Flashing...')}
                {(lastTask.status === 'failed' || lastTask.status === 'cancelled') &&
                  `Flash failed: ${lastTask.error ?? 'unknown error'}`}
              </span>
            </div>
          )}

          {isViewOnly && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-700 dark:text-amber-400 flex gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Flash is disabled in view-only mode</span>
            </div>
          )}
        </div>
      </div>

      <Card className="p-4 bg-muted/40 border-dashed">
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="font-semibold text-foreground">Tips</div>
          <ul className="list-disc list-inside space-y-1">
            <li>.ino sketches are compiled on the hub with arduino-cli; the board type decides how.</li>
            <li>Precompiled images flash faster: .hex for AVR boards, .bin for the Uno R4, .bin/.elf/.hex for STM32.</li>
            <li>Compiling for STM32 on a Pi can take several minutes the first time.</li>
            <li>Flash hangs? Unplug and re-plug the board, then try again.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
