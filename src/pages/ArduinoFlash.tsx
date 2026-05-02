import { useState, useEffect, useRef } from 'react';
import { useHubStore } from '@/stores/hubStore';
import { useAuthStore } from '@/stores/authStore';
import { hubsApi } from '@/services/api';
import { commandService } from '@/services/commandService';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Upload, Play} from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { fromByteArray, toByteArray } from 'base64-js';
import sketches from '@/config/arduino-sketches.json';
import type { PortInfo } from '@/types';

interface SketchPreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

interface SketchesConfig {
  presets: SketchPreset[];
}

const sketchConfig = sketches as SketchesConfig;

function getApiErrorDetail(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'detail' in error.response.data &&
    typeof error.response.data.detail === 'string'
  ) {
    return error.response.data.detail;
  }

  return null;
}

// Heuristic mapping from port info to likely board FQBN
const inferBoardFqbn = (port?: PortInfo): string | undefined => {
  if (!port) return undefined;

  const desc = port.description?.toLowerCase() || '';
  const manufacturer = port.manufacturer?.toLowerCase() || '';
  const vid = port.vendor_id?.toLowerCase();
  const pid = port.product_id?.toLowerCase();

  const has = (text: string) => desc.includes(text) || manufacturer.includes(text);

  // Arduino official VID
  const isArduinoVid = vid === '2341';
  // Common clone VID (CH340/CH341)
  const isCh34x = vid === '1a86' || vid === '0403';
  const looksLikeArduino = isArduinoVid || has('arduino');

  // ESP32 VID and descriptors
  const isEspressifVid = vid === '303a';
  const looksLikeEsp32 = isEspressifVid || has('esp32');

  // Arduino family heuristics
  if (looksLikeArduino || isCh34x) {
    if (desc.includes('mega') || pid === '0010' || pid === '0042') return 'arduino:avr:mega';
    if (desc.includes('nano') || pid === '7523') return 'arduino:avr:nano';
    return 'arduino:avr:uno';
  }

  // ESP32 family heuristics
  if (looksLikeEsp32) {
    return 'esp32:esp32:esp32';
  }

  // Fallback: inspect description keywords
  if (desc.includes('uno')) return 'arduino:avr:uno';
  if (desc.includes('mega')) return 'arduino:avr:mega';
  if (desc.includes('nano')) return 'arduino:avr:nano';
  if (desc.includes('esp32')) return 'esp32:esp32:esp32';

  return undefined;
};

// Quick heuristic to detect Intel HEX content (lines starting with ':' and hex chars)
const isProbablyIntelHex = (text: string): boolean => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean).slice(0, 6);
  if (!lines.length) return false;
  return lines.every((line) => line.startsWith(':') && /^:[0-9A-Fa-f]+$/.test(line.trim()));
};

export function ArduinoFlash() {
  const [selectedSketch, setSelectedSketch] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [selectedHub, setSelectedHub] = useState<string>('');
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [selectedBoard, setSelectedBoard] = useState<string>('');
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  const { hubs = [], fetchHubs } = useHubStore();
  const { user } = useAuthStore();
  const isViewOnly = user?.role === "viewer";

  // Fetch hubs on mount
  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  // Initialize CodeMirror editor
  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        cpp(),
        oneDark,
      ],
    });

    editorViewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    return () => {
      editorViewRef.current?.destroy();
    };
  }, []);

  // Update editor content when it changes
  useEffect(() => {
    if (editorViewRef.current) {
      const currentContent = editorViewRef.current.state.doc.toString();
      if (currentContent !== fileContent) {
        editorViewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: fileContent,
          },
        });
      }
    }
  }, [fileContent]);

  // Fetch ports when hub selection changes
  useEffect(() => {
    if (!selectedHub) {
      setPorts([]);
      return;
    }

    const fetchPorts = async () => {
      setIsLoadingPorts(true);
      try {
        const portsList = await hubsApi.getPorts(selectedHub);
        setPorts(portsList);
        setSelectedPort(''); // Reset port selection
      } catch (error) {
        console.error('Error fetching ports:', error);
        setPorts([]);
      } finally {
        setIsLoadingPorts(false);
      }
    };

    fetchPorts();
  }, [selectedHub]);

  // Handle preset sketch selection
  const handleSketchSelect = (sketchId: string) => {
    setSelectedSketch(sketchId);
    const sketch = sketchConfig.presets.find((s) => s.id === sketchId);
    if (sketch) {
      try {
        // Decode base64 to string
        const decodedBytes = toByteArray(sketch.content);
        const decodedString = String.fromCharCode(...decodedBytes);
        setFileContent(decodedString);
      } catch (error) {
        console.error('Error decoding sketch:', error);
      }
    }
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();

    // Require precompiled Intel HEX for now; guide users if they upload .ino
    if (ext === 'ino') {
      alert('Please compile the .ino to a .hex first (e.g., arduino-cli compile --fqbn <board> <sketch>), then upload the .hex.');
      event.target.value = '';
      return;
    }

    if (ext && ext !== 'hex') {
      alert('Unsupported file type. Please upload a compiled .hex file.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = (e.target?.result as string) || '';

        // Validate Intel HEX structure to avoid sending bad payloads
        if (!isProbablyIntelHex(content)) {
          alert('This file does not look like a valid Intel HEX. Please upload the compiled .hex output.');
          event.target.value = '';
          return;
        }

        setFileContent(content);
        setSelectedSketch(''); // Clear preset selection when uploading
      } catch (error) {
        console.error('Error reading file:', error);
      }
    };
    reader.readAsText(file);
  };

  // Handle flash button click
  const handleFlash = async () => {
    if (!selectedHub || !selectedPort || !fileContent) {
      alert('Please select a hub, port, and ensure code is loaded');
      return;
    }

    // Determine board FQBN: user selection wins; otherwise infer from port metadata
    const selectedPortInfo = ports.find((p) => p.port_id === selectedPort);
    const inferredBoard = inferBoardFqbn(selectedPortInfo);
    const boardFqbn = selectedBoard && selectedBoard !== 'auto' ? selectedBoard : inferredBoard;

    // For .ino files, board FQBN is required for compilation
    const isInoSource = !isProbablyIntelHex(fileContent);
    if (isInoSource && !boardFqbn) {
      alert('Please select a board type for compiling the Arduino sketch');
      return;
    }

    try {
      // Convert file content to base64
      const bytes = new TextEncoder().encode(fileContent);
      const base64Content = fromByteArray(bytes);

      // Initiate flash command
      await commandService.flash(
        selectedHub,
        selectedPort,
        base64Content,
        boardFqbn,
        undefined,
        { showSuccessToast: false, showErrorToast: false }
      );

      alert(isInoSource ? 'Sketch will be compiled and flashed on the hub!' : 'Flash command sent successfully!');
    } catch (error: unknown) {
      console.error('Error starting flash:', error);
      alert(`Failed to start flash process: ${getApiErrorDetail(error) || 'Unknown error'}`);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Arduino Firmware Flash</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Upload and flash Arduino sketches to your devices</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-6">
        {/* Code Editor Panel */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-4">Code Editor</h2>

            {/* File Selector */}
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
                  <input
                    type="file"
                    accept=".ino,.hex"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {selectedSketch && (
                <p className="text-xs text-muted-foreground">
                  Loaded: {sketchConfig.presets.find((s) => s.id === selectedSketch)?.description}
                </p>
              )}
            </div>

            {/* CodeMirror Editor */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div
                ref={editorRef}
                className="h-96 [&_.cm-editor]:h-full [&_.cm-editor]:bg-[#282c34] [&_.cm-editor]:border-none [&_.cm-editor]:rounded-lg [&_.cm-content]:text-[13px] [&_.cm-content]:font-mono [&_.cm-gutters]:bg-[#21252b] [&_.cm-gutters]:border-border [&_.cm-linenumber]:text-[#6b7280] [&_.cm-linenumber]:text-xs [&_.cm-cursor]:border-l-2 [&_.cm-cursor]:border-[#61afef]"
              />
            </div>

            {fileContent && (
              <div className="mt-2 text-xs text-muted-foreground">
                {fileContent.split('\n').length} lines • {fileContent.length} characters
              </div>
            )}
          </Card>
        </div>

        {/* Control Panel */}
        <div className="space-y-4">
          {/* Hub & Port Selection */}
          <Card className="p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-4">Target Device</h2>

            <div className="space-y-4 overflow-y-auto max-h-96 pr-2 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
              {/* Hub Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Hub</label>
                <Select value={selectedHub} onValueChange={setSelectedHub}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select hub..." />
                  </SelectTrigger>
                  <SelectContent>
                    {hubs.map((hub) => (
                      <SelectItem key={hub.hubId} value={hub.hubId}>
                        {hub.hubId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Port Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Port</label>
                <Select value={selectedPort} onValueChange={setSelectedPort} disabled={isLoadingPorts || !selectedHub}>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoadingPorts ? "Loading ports..." : "Select port..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {ports.map((port) => (
                      <SelectItem key={port.port_id} value={port.port_id}>
                        {port.description || port.port}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Board Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Board (Optional)</label>
                <Select value={selectedBoard} onValueChange={setSelectedBoard}>
                  <SelectTrigger>
                    <SelectValue placeholder="Auto-detect..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="arduino:avr:uno">Arduino Uno</SelectItem>
                    <SelectItem value="arduino:avr:mega">Arduino Mega</SelectItem>
                    <SelectItem value="arduino:avr:nano">Arduino Nano</SelectItem>
                    <SelectItem value="esp32:esp32:esp32">ESP32 (Default)</SelectItem>
                    <SelectItem value="esp32:esp32:esp32wrover">ESP32 Wrover</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Info Box */}
              {selectedPort && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-700 dark:text-blue-400 flex gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Board will be auto-detected during flash.</span>
                </div>
              )}
            </div>
          </Card>

          {/* Flash Button */}
          <Button
            onClick={handleFlash}
            disabled={!selectedHub || !selectedPort || !fileContent || isViewOnly}
            className="w-full gap-2 h-10"
            size="lg"
            title={isViewOnly ? "View-only mode does not allow flashing" : ""}
          >
            <Play className="h-4 w-4" />
            {isViewOnly ? "Read-Only Mode" : "Flash"}
          </Button>

          {isViewOnly && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-700 dark:text-amber-400 flex gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Flash is disabled in view-only mode</span>
            </div>
          )}
        </div>
      </div>

      {/* Helpful tips section */}
      <Card className="p-4 bg-muted/40 border-dashed">
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="font-semibold text-foreground">Tips</div>
          <ul className="list-disc list-inside space-y-1">
            <li>Upload .ino files directly - they will be compiled on the RPI hub using Arduino CLI.</li>
            <li>You can also upload pre-compiled .hex files for faster flashing.</li>
            <li>Flash hangs? Serial write stops working? Unplug and re-plug the board, then try again.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
