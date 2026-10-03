import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Prec } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

/** One Dark syntax colors on the Hub Manager editor surface. */
const surface = Prec.highest(
  EditorView.theme(
    {
      '&': { height: '100%', backgroundColor: '#0B0B0B', color: '#D6D6D6', fontSize: '13px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace", lineHeight: '20px' },
      '.cm-content': { padding: '14px 0', caretColor: '#F5F5F5' },
      '.cm-gutters': { backgroundColor: '#0B0B0B', color: '#4D4D4D', borderRight: '1px solid #161616' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 14px 0 16px', minWidth: '52px' },
      '.cm-activeLine': { backgroundColor: '#111111' },
      '.cm-activeLineGutter': { backgroundColor: '#111111', color: '#8C8C8C' },
      '&.cm-focused .cm-cursor': { borderLeftColor: '#F5F5F5' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'rgba(179, 27, 27, 0.45)',
      },
      '.cm-panels': { backgroundColor: '#161616', color: '#F5F5F5' },
    },
    { dark: true }
  )
);

/**
 * C++ editor for sketches and Intel HEX. `value` is pushed in when it changes from outside
 * (presets, uploads); typing reports back through `onChange` without echoing.
 */
export function FirmwareEditor({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const applyingExternal = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!host.current) return;
    view.current = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          cpp(),
          oneDark,
          surface,
          EditorView.contentAttributes.of({ 'aria-label': 'Firmware source' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternal.current) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: host.current,
    });
    return () => view.current?.destroy();
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      applyingExternal.current = true;
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      applyingExternal.current = false;
    }
  }, [value]);

  return <div ref={host} className="h-full" />;
}
