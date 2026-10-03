import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from '@/stores/uiStore';
import { deleteCustomSchema, generateArduinoPrintStatement, generateRegexPattern, saveCustomSchema } from '@/lib/customSchemas';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Segmented } from '@/components/ui/primitives';
import { Sheet, SheetBody, SheetFooter } from '@/components/ui/overlay';
import type { SensorField, SensorMapping } from '@/types';

type Format = SensorMapping['format'];

const FORMATS: { value: Format; label: string; hint: string }[] = [
  { value: 'key-value', label: 'Key-value', hint: 'Lines like temp=25.3 hum=60.2' },
  { value: 'csv', label: 'CSV', hint: 'Lines like 25.3,60.2' },
  { value: 'json', label: 'JSON', hint: 'Lines like {"temp": 25.3}' },
];

const NEW_FIELD_COLOR = '#5AA9E6';

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="rounded-[4px] border border-edge bg-ink p-3 font-mono text-xs leading-[18px] text-[#D6D6D6] [overflow-wrap:anywhere] select-text">
      {children}
    </div>
  );
}

/** Create a custom chart schema, or view (and delete) a saved one. */
export function SchemaSheet({ schema, onClose }: { schema?: SensorMapping; onClose: () => void }) {
  const viewing = !!schema;
  const [name, setName] = useState(schema?.name ?? '');
  const [description, setDescription] = useState(schema?.description ?? '');
  const [format, setFormat] = useState<Format>(schema?.format ?? 'key-value');
  const [fields, setFields] = useState<SensorField[]>(schema?.fields ?? []);

  const pattern = schema ? schema.pattern : generateRegexPattern(format, fields);
  const valid = !!(name.trim() && pattern.trim() && fields.length > 0 && fields.every((f) => f.name.trim()));

  const patchField = (i: number, patch: Partial<SensorField>) => setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const save = () => {
    if (!valid) return;
    saveCustomSchema({ id: crypto.randomUUID(), name: name.trim(), description: description.trim(), format, pattern, fields });
    toast(`Saved schema ${name.trim()}`);
    onClose();
  };

  const remove = () => {
    if (!schema || !window.confirm('Are you sure you want to delete this schema?')) return;
    deleteCustomSchema(schema.id);
    toast(`Deleted schema ${schema.name}`);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} width={560} kicker={viewing ? 'Custom schema' : 'Sensor charts'} title={schema ? schema.name : 'New chart schema'}>
      <SheetBody className="flex flex-col gap-[18px] pt-5">
        <Field label="Schema name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} readOnly={viewing} placeholder="e.g. DHT22 Sensor" />
        </Field>
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} readOnly={viewing} placeholder="e.g. Temperature and humidity sensor" />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Data format</span>
          <Segmented
            label="Data format"
            className="self-start"
            options={FORMATS}
            value={format}
            onChange={(v) => !viewing && setFormat(v)}
          />
          <span className="text-xs text-fg-3">{FORMATS.find((f) => f.value === format)?.hint}</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold">Fields</span>
            {!viewing && (
              <Button
                size="xs"
                onClick={() => setFields((prev) => [...prev, { name: '', unit: '', color: NEW_FIELD_COLOR, captureGroup: prev.length + 1 }])}
              >
                <Plus size={14} />
                Add field
              </Button>
            )}
          </div>
          {fields.length === 0 ? (
            <div className="py-3.5 text-[13px] text-fg-3">No fields yet. Add one per value your sketch prints.</div>
          ) : (
            <div className="kicker grid grid-cols-[minmax(0,1fr)_84px_64px_44px_32px] gap-2">
              <span>Name</span>
              <span>Unit</span>
              <span>Group</span>
              <span>Color</span>
              <span />
            </div>
          )}
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_84px_64px_44px_32px] items-center gap-2">
              <TextInput className="h-10" aria-label="Field name" value={f.name} readOnly={viewing} placeholder="temperature" onChange={(e) => patchField(i, { name: e.target.value })} />
              <TextInput className="h-10" aria-label="Unit" value={f.unit} readOnly={viewing} placeholder="°C" onChange={(e) => patchField(i, { unit: e.target.value })} />
              <TextInput
                className="h-10 px-2 font-mono text-[13px]"
                aria-label="Capture group"
                type="number"
                min={1}
                value={f.captureGroup}
                readOnly={viewing}
                onChange={(e) => patchField(i, { captureGroup: parseInt(e.target.value, 10) || 1 })}
              />
              <input
                type="color"
                aria-label="Line color"
                value={f.color}
                disabled={viewing}
                onChange={(e) => patchField(i, { color: e.target.value })}
                className="h-10 w-11 cursor-pointer rounded-[4px] border-0 bg-field p-1 disabled:cursor-default"
              />
              {!viewing ? (
                <Button variant="ghost" size="icon" aria-label="Remove field" onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}>
                  <X size={16} />
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Generated regex</span>
          <CodeBlock>{pattern || 'Pattern appears when you add fields'}</CodeBlock>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Arduino print statement</span>
          <CodeBlock>{generateArduinoPrintStatement(format, pattern, fields)}</CodeBlock>
          <span className="text-xs text-fg-3">Use as a reference for your sketch's Serial.print() calls.</span>
        </div>
      </SheetBody>

      <SheetFooter className="flex-row">
        {viewing ? (
          <>
            <Button variant="danger" size="xl" className="px-5 text-[15px]" onClick={remove}>
              Delete schema
            </Button>
            <Button size="xl" className="flex-1 text-[15px]" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button size="xl" className="px-5 text-[15px]" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="xl" className="flex-1" disabled={!valid} onClick={save}>
              Save schema
            </Button>
          </>
        )}
      </SheetFooter>
    </Sheet>
  );
}
