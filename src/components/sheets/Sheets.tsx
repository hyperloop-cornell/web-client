import { useUiStore } from '@/stores/uiStore';
import { HubSheet } from './HubSheet';
import { DeviceSheet } from './DeviceSheet';
import { TerminalSheet } from './TerminalSheet';
import { AddStreamsSheet } from './AddStreamsSheet';
import { SchemaSheet } from './SchemaSheet';

/** Renders whichever side sheet uiStore says is open. */
export function Sheets() {
  const sheet = useUiStore((s) => s.sheet);
  const close = useUiStore((s) => s.closeSheet);

  switch (sheet?.kind) {
    case 'hub':
      return <HubSheet key={sheet.hubId} hubId={sheet.hubId} onClose={close} />;
    case 'device':
      return <DeviceSheet key={sheet.key} deviceKey={sheet.key} onClose={close} />;
    case 'terminal':
      return <TerminalSheet key={sheet.key} deviceKey={sheet.key} onClose={close} />;
    case 'add-streams':
      return <AddStreamsSheet onClose={close} />;
    case 'schema':
      return <SchemaSheet key={sheet.schema?.id ?? 'new'} schema={sheet.schema} onClose={close} />;
    default:
      return null;
  }
}
