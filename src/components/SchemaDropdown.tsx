import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { getCustomSchemas, deleteCustomSchema } from '@/lib/customSchemas';
import { ViewSchemaModal } from '@/components/ViewSchemaModal';
import type { SensorMapping } from '@/types';

interface SchemaDropdownProps {
  onAddNew: () => void;
}

export function SchemaDropdown({ onAddNew }: SchemaDropdownProps) {
  const [schemas, setSchemas] = useState<SensorMapping[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState<SensorMapping | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);

    if (open) {
      setSchemas(getCustomSchemas());
    }
  };

  const handleDelete = (schemaId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (confirm('Are you sure you want to delete this schema?')) {
      deleteCustomSchema(schemaId);
      setSchemas(schemas.filter(s => s.id !== schemaId));
    }
  };

  const handleViewSchema = (schema: SensorMapping) => {
    setSelectedSchema(schema);
    setShowViewModal(true);
  };

  const handleAddNew = () => {
    setIsOpen(false);
    onAddNew();
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="text-white">
            <ChevronDown className="h-4 w-4 mr-2" />
            Schemas
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 border border-border">
          {schemas.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No custom schemas saved
            </div>
          ) : (
            <>
              <div className="max-h-60 overflow-y-auto border-b border-border">
                {schemas.map((schema) => (
                  <div key={schema.id} className="flex items-center justify-between px-2 py-2 hover:bg-accent rounded-sm group cursor-pointer" onClick={() => handleViewSchema(schema)}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{schema.name}</div>
                      {schema.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {schema.description}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleDelete(schema.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
          <DropdownMenuItem onClick={handleAddNew} className="cursor-pointer">
            <Plus className="h-4 w-4 mr-2" />
            Add New Schema
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ViewSchemaModal open={showViewModal} onOpenChange={setShowViewModal} schema={selectedSchema} />
    </>
  );
}
