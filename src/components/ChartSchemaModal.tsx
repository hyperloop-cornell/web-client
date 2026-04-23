import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';
import { generateArduinoPrintStatement, generateRegexPattern } from '@/lib/customSchemas';
import type { SensorMapping, SensorField } from '@/types';

type SensorFormat = 'key-value' | 'csv' | 'json';

interface ChartSchemaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (schema: SensorMapping) => void;
}

export function ChartSchemaModal({ open, onOpenChange, onSave }: ChartSchemaModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<SensorFormat>('key-value');
  const [fields, setFields] = useState<SensorField[]>([]);

  const addField = () => {
    setFields([
      ...fields,
      { name: '', unit: '', color: '#3b82f6', captureGroup: fields.length + 1 }
    ]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<SensorField>) => {
    setFields(fields.map((field, i) => (i === index ? { ...field, ...updates } : field)));
  };

  const generatedPattern = generateRegexPattern(format, fields);

  const handleSave = () => {
    const schema: SensorMapping = {
      id: crypto.randomUUID(),
      name,
      description,
      format,
      pattern: generatedPattern,
      fields,
    };
    onSave(schema);
    
    // Reset form
    setName('');
    setDescription('');
    setFormat('key-value');
    setFields([]);
    onOpenChange(false);
  };

  const isValid = name.trim() && generatedPattern.trim() && fields.length > 0 && fields.every(f => f.name.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-cyan-400">Create Custom Chart Schema</DialogTitle>
          <DialogDescription>
            Define a custom sensor data format for automatic chart generation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-cyan-400">Schema Name</Label>
            <Input
              id="name"
              placeholder="e.g., DHT22 Sensor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-cyan-400">Description</Label>
            <Input
              id="description"
              placeholder="e.g., Temperature and humidity sensor"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="format" className="text-cyan-400">Data Format</Label>
            <Select value={format} onValueChange={(value) => setFormat(value as SensorFormat)}>
              <SelectTrigger id="format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="key-value">Key-Value (e.g., temp=25.3)</SelectItem>
                <SelectItem value="csv">CSV (e.g., 25.3,60.2)</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-cyan-400">Fields</Label>
              <Button type="button" variant="outline" size="sm" onClick={addField} className="text-white">
                <Plus className="h-4 w-4 mr-1" />
                Add Field
              </Button>
            </div>
            
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No fields added yet. Click "Add Field" to start.</p>
            ) : (
              <div className="space-y-3 border rounded-md p-3">
                {fields.map((field, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 border rounded-md">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Field name (e.g., temperature)"
                        value={field.name}
                        onChange={(e) => updateField(index, { name: e.target.value })}
                        className="text-sm text-foreground"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="Unit (e.g., °C)"
                          value={field.unit}
                          onChange={(e) => updateField(index, { unit: e.target.value })}
                          className="text-sm flex-1 text-foreground"
                        />
                        <Input
                          type="number"
                          placeholder="Group #"
                          value={field.captureGroup}
                          onChange={(e) => updateField(index, { captureGroup: parseInt(e.target.value) || 1 })}
                          className="w-20 text-sm text-foreground [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100"
                          min="1"
                        />
                        <Input
                          type="color"
                          value={field.color}
                          onChange={(e) => updateField(index, { color: e.target.value })}
                          className="w-20"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeField(index)}
                      className="text-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <Label htmlFor="regex-pattern" className="text-cyan-400">Generated Regex Pattern</Label>
            <Textarea
              id="regex-pattern"
              readOnly
              value={generatedPattern || '(pattern will appear when you add fields)'}
              className="font-mono text-xs text-foreground bg-muted/50 [user-select:text] [pointer-events:auto]"
              rows={2}
              style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
            />
            <p className="text-xs text-muted-foreground">
              This regex is automatically generated from your format and fields. You can copy it if needed.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <Label htmlFor="arduino-code" className="text-cyan-400">Arduino Print Statement</Label>
            <Textarea
              id="arduino-code"
              readOnly
              value={generateArduinoPrintStatement(format, generatedPattern, fields)}
              className="font-mono text-xs text-foreground bg-muted/50 [user-select:text] [pointer-events:auto]"
              rows={3}
              style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
            />
            <p className="text-xs text-muted-foreground">
              Use this as a reference for your Arduino sketch's Serial.print() statements. Text can be selected and copied.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-foreground">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            Save Schema
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
