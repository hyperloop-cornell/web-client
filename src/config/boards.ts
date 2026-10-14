import type { ArtifactFormat, BoardProfileInfo } from '@/types';

/**
 * Boards the flash page offers. Mirrors rpi-hub-server/config/boards.yaml (id, name, fqbn,
 * artifacts); keep the two in sync when adding a board. Hubs report the detected board for each
 * port (PortInfo.board_profile), which is preselected; this list is for choosing another one.
 */
export const BOARDS: BoardProfileInfo[] = [
  { id: 'uno_r3', name: 'Arduino Uno R3', fqbn: 'arduino:avr:uno', artifacts: ['ino', 'hex'] },
  { id: 'mega2560', name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega', artifacts: ['ino', 'hex'] },
  { id: 'nano_ch340', name: 'Arduino Nano (CH340 clone)', fqbn: 'arduino:avr:nano', artifacts: ['ino', 'hex'] },
  { id: 'uno_r4_minima', name: 'Arduino Uno R4 Minima', fqbn: 'arduino:renesas_uno:minima', artifacts: ['ino', 'bin'] },
  { id: 'uno_r4_wifi', name: 'Arduino Uno R4 WiFi', fqbn: 'arduino:renesas_uno:unor4wifi', artifacts: ['ino', 'bin'] },
  {
    id: 'disco_f407vg',
    name: 'STM32F407G-DISC1',
    fqbn: 'STMicroelectronics:stm32:Disco:pnum=DISCO_F407VG',
    artifacts: ['ino', 'bin', 'elf', 'hex'],
  },
];

export function findBoard(id: string | null | undefined): BoardProfileInfo | undefined {
  return BOARDS.find((board) => board.id === id);
}

/** Formats a hub can flash, from its handshake capabilities (older hubs: .ino and .hex). */
export function hubFlashFormats(capabilities: string[] | undefined): ArtifactFormat[] {
  const formats = (capabilities ?? [])
    .filter((cap) => cap.startsWith('flash:'))
    .map((cap) => cap.slice('flash:'.length) as ArtifactFormat);
  return formats.length > 0 ? formats : ['ino', 'hex'];
}

/** Firmware format from a file name, or null if the extension is not a firmware format. */
export function formatFromFileName(name: string): ArtifactFormat | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'ino' || ext === 'hex' || ext === 'bin' || ext === 'elf' ? ext : null;
}

export const BINARY_FORMATS: ReadonlySet<ArtifactFormat> = new Set(['bin', 'elf']);

export type Flasher = 'arduino-cli' | 'openocd';

/**
 * Tool the hub flashes each board with (mirrors `flasher` in rpi-hub-server/config/boards.yaml).
 * Not in the API contract yet; see .claude/ui-overhaul.md in hyperloop-gui for the plan to
 * report it from the hub instead.
 */
const FLASHERS: Record<string, Flasher> = {
  uno_r3: 'arduino-cli',
  mega2560: 'arduino-cli',
  nano_ch340: 'arduino-cli',
  uno_r4_minima: 'arduino-cli',
  uno_r4_wifi: 'arduino-cli',
  disco_f407vg: 'openocd',
};

export function flasherFor(board: BoardProfileInfo | undefined): Flasher | undefined {
  return board ? (FLASHERS[board.id] ?? 'arduino-cli') : undefined;
}
