import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CommandButton } from '@/components/ui/CommandButton';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, ChevronRight, Send, Terminal as TerminalIcon, Clock } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult, DragStart, DragUpdate } from '@hello-pangea/dnd';
import { commandService } from '@/services/commandService';
import { format } from 'date-fns';
import type {
  TimeWindow,
  SensorMapping,
  CustomTimeRange,
  DeviceChartData,
  ChartData,
  MergedChartData,
  ActiveSubscription,
  FieldChartData,
  ChartDataPoint,
} from '@/types';
import { isMergedChart } from '@/types';
import { useHubStore } from '@/stores/hubStore';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { ChartSchemaModal } from '@/components/ChartSchemaModal';
import { SchemaDropdown } from '@/components/SchemaDropdown';
import { DeviceChart } from '@/components/DeviceChart';
import { saveCustomSchema } from '@/lib/customSchemas';

type ChartEntry = {
  sub: ActiveSubscription;
  chartData: DeviceChartData | null;
  key: string;
};

export function LiveTelemetry() {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1h');
  const [customTimeRange, setCustomTimeRange] = useState<CustomTimeRange | null>(null);
  const [showCustomTimeDialog, setShowCustomTimeDialog] = useState(false);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customStartTime, setCustomStartTime] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [customEndTime, setCustomEndTime] = useState('');
  const [serialInputs, setSerialInputs] = useState<Map<string, string>>(new Map());
  const [expandedTerminals, setExpandedTerminals] = useState<Set<string>>(new Set());
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [chartOrder, setChartOrder] = useState<string[]>([]);
  const [mergedCharts, setMergedCharts] = useState<Map<string, MergedChartData>>(new Map());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [shiftPressed, setShiftPressed] = useState<boolean>(false);

  const { activeSubscriptions } = useHubStore();
  const { devices: telemetryDevices, getChartData } = useTelemetryStore();

  // Get devices with chart data
  const devicesWithCharts = activeSubscriptions
    .map((sub: ActiveSubscription): ChartEntry => {
      const key = `${sub.hubId}:${sub.portId}`;

      // Fetch raw fields from store (getChartData already applies a time window filter for standard windows)
      const rawFields = timeWindow === 'custom' && customTimeRange
        ? getChartData(sub.hubId, sub.portId, '1h')
        : getChartData(sub.hubId, sub.portId, timeWindow);

      // If custom range selected, further filter the returned points to within start..end
      const filteredFields: FieldChartData[] = (timeWindow === 'custom' && customTimeRange)
        ? rawFields.map((f: FieldChartData) => ({
            ...f,
            data: f.data.filter((p: ChartDataPoint) => p.timestamp >= customTimeRange.start.getTime() && p.timestamp <= customTimeRange.end.getTime())
          }))
        : rawFields;

      const deviceData = telemetryDevices.get(key);

      // Build a DeviceChartData using the device's meta plus filtered fields
      const deviceChartData: DeviceChartData | null = deviceData && deviceData.chartData
        ? { ...deviceData.chartData, fields: filteredFields }
        : null;

      return { sub, chartData: deviceChartData, key };
    })
    .filter((entry): entry is ChartEntry & { chartData: DeviceChartData } => !!entry.chartData && entry.chartData.fields.length > 0);

  // Combine device charts with merged charts
  const allCharts = new Map<string, ChartData>();
  
  // Add individual device charts
  devicesWithCharts.forEach(({ key, chartData }) => {
    if (chartData && !Array.from(mergedCharts.values()).some(m => m.sources.some(s => `${s.hubId}:${s.portId}` === key))) {
      allCharts.set(key, chartData);
    }
  });
  
  // Add merged charts
  mergedCharts.forEach((chart, id) => {
    allCharts.set(id, chart);
  });

  const orderedChartKeys = (() => {
    const newKeys = Array.from(allCharts.keys());
    const existingKeys = chartOrder.filter((key) => newKeys.includes(key));
    const missingKeys = newKeys.filter((key) => !chartOrder.includes(key));
    return [...existingKeys, ...missingKeys];
  })();

  const applyCustomTimeRange = () => {
    if (!customStartDate || !customStartTime || !customEndDate || !customEndTime) {
      return;
    }
    
    const start = new Date(`${customStartDate}T${customStartTime}`);
    const end = new Date(`${customEndDate}T${customEndTime}`);
    
    if (start >= end) {
      alert('Start time must be before end time');
      return;
    }
    
    setCustomTimeRange({ start, end });
    setTimeWindow('custom');
    setShowCustomTimeDialog(false);
  };

  const handleTimeWindowChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomTimeDialog(true);
    } else {
      setTimeWindow(value as TimeWindow);
      setCustomTimeRange(null);
    }
  };

  const onDragEnd = (result: DropResult) => {
    setDraggedIndex(null);
    setDropTargetIndex(null);
    
    if (!result.destination) return;
    
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    
    // If same position, do nothing
    if (sourceIndex === destIndex) return;
    
    // Merge if Shift key was held during drop
    if (shiftPressed) {
      const sourceKey = chartOrder[sourceIndex];
      const destKey = chartOrder[destIndex];
      
      const sourceChart = allCharts.get(sourceKey);
      const destChart = allCharts.get(destKey);
      
      if (sourceChart && destChart) {
        // Extract DeviceChartData from both sources
        const sourceSources: DeviceChartData[] = isMergedChart(sourceChart) 
          ? sourceChart.sources 
          : [sourceChart];
        const destSources: DeviceChartData[] = isMergedChart(destChart) 
          ? destChart.sources 
          : [destChart];
        
        // Create new merged chart
        const mergedId = `merged-${Date.now()}`;
        const newMerged: MergedChartData = {
          id: mergedId,
          sources: [...destSources, ...sourceSources],
          isMerged: true
        };
        
        // Update merged charts
        const newMergedCharts = new Map(mergedCharts);
        
        // Remove old merged charts if they existed
        if (isMergedChart(sourceChart)) {
          newMergedCharts.delete(sourceChart.id);
        }
        if (isMergedChart(destChart)) {
          newMergedCharts.delete(destChart.id);
        }
        
        newMergedCharts.set(mergedId, newMerged);
        setMergedCharts(newMergedCharts);
        
        // Update chart order: remove source, replace dest with merged
        const newOrder = chartOrder.filter((_, i) => i !== sourceIndex);
        const adjustedDestIndex = sourceIndex < destIndex ? destIndex - 1 : destIndex;
        newOrder[adjustedDestIndex] = mergedId;
        setChartOrder(newOrder);
        
        return;
      }
    }
    
    // Just reorder
    const items = Array.from(chartOrder);
    const [reorderedItem] = items.splice(sourceIndex, 1);
    items.splice(destIndex, 0, reorderedItem);
    setChartOrder(items);
  };
  
  const onDragStart = (start: DragStart) => {
    setDraggedIndex(start.source.index);
  };
  
  const onDragUpdate = (update: DragUpdate) => {
    if (update.destination) {
      setDropTargetIndex(update.destination.index);
    } else {
      setDropTargetIndex(null);
    }
  };
  
  // Track Shift key for merge mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(false);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  const handleSeparateChart = (chartId: string) => {
    const chart = mergedCharts.get(chartId);
    if (!chart) return;
    
    // Remove the merged chart
    const newMergedCharts = new Map(mergedCharts);
    newMergedCharts.delete(chartId);
    setMergedCharts(newMergedCharts);
    
    // Add individual charts back to order
    const chartIndex = chartOrder.indexOf(chartId);
    const newOrder = [...chartOrder];
    newOrder.splice(chartIndex, 1);
    
    // Insert individual chart keys
    const individualKeys = chart.sources.map(s => `${s.hubId}:${s.portId}`);
    newOrder.splice(chartIndex, 0, ...individualKeys);
    
    setChartOrder(newOrder);
  };

  const handleSerialInput = (key: string, value: string) => {
    setSerialInputs(new Map(serialInputs).set(key, value));
  };

  const handleSendSerial = async (hubId: string, portId: string, key: string) => {
    const data = serialInputs.get(key) || '';
    if (!data.trim()) return;

    await commandService.serialWrite(hubId, portId, data);
    
    // Clear input after sending
    setSerialInputs(new Map(serialInputs).set(key, ''));
  };

  const toggleTerminal = (key: string) => {
    const newExpanded = new Set(expandedTerminals);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedTerminals(newExpanded);
  };

  const handleSaveSchema = (schema: SensorMapping) => {
    saveCustomSchema(schema);
    // Toast notification could be added here
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-cyan-400">Live Telemetry</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            Real-time sensor data from subscribed devices
          </p>
        </div>
      </div>

      {/* Serial Terminals Section */}
      <div className="space-y-3">
        <h2 className="text-lg sm:text-xl font-semibold text-cyan-400">Serial Terminals</h2>
        {activeSubscriptions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <TerminalIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                Serial Terminals
              </CardTitle>
            </CardHeader>
            <CardContent className="py-6 sm:py-8">
              <p className="text-center text-sm sm:text-base text-muted-foreground">
                No active subscriptions. Subscribe to devices in Device Manager.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {activeSubscriptions.map((sub: ActiveSubscription) => {
              const key = `${sub.hubId}:${sub.portId}`;
              const device = telemetryDevices.get(key);
              const isExpanded = expandedTerminals.has(key);
              const lastLines = device?.rawData 
                ? device.rawData.split('\n').slice(-20).join('\n') 
                : 'No data yet';
              const inputValue = serialInputs.get(key) || '';
              
              return (
                <Collapsible
                  key={key}
                  open={isExpanded}
                  onOpenChange={() => toggleTerminal(key)}
                >
                  <Card>
                    <CardHeader className="relative">
                      <CollapsibleTrigger className="w-full cursor-pointer hover:bg-accent/50 transition-colors rounded-md p-2 -mx-2">
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          )}
                          <CardTitle className="text-base">
                            {sub.hubId} → Port {sub.portId}
                          </CardTitle>
                          {sub.sensorType && (
                            <Badge variant="outline" className="text-xs">
                              {sub.sensorName || sub.sensorType}
                            </Badge>
                          )}
                        </div>
                      </CollapsibleTrigger>
                      <div className="absolute top-2 right-2">
                        <CommandButton
                          hubId={sub.hubId}
                          portId={sub.portId}
                          commandType="restart"
                          variant="outline"
                          size="sm"
                        />
                      </div>
                    </CardHeader>
                    
                    <CollapsibleContent>
                      <CardContent className="space-y-3">
                        <pre className="bg-black text-white p-3 rounded text-xs whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                          {lastLines}
                        </pre>
                        
                        {/* Serial Write Input */}
                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            placeholder="Type data to send..."
                            value={inputValue}
                            onChange={(e) => handleSerialInput(key, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendSerial(sub.hubId, sub.portId, key);
                              }
                            }}
                            className="flex-1 text-sm"
                          />
                          <Button
                            onClick={() => handleSendSerial(sub.hubId, sub.portId, key)}
                            size="sm"
                            disabled={!inputValue.trim()}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>

      {/* Charts Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
          <h2 className="text-lg sm:text-xl font-semibold text-cyan-400">Sensor Charts</h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Select value={timeWindow} onValueChange={handleTimeWindowChange}>
              <SelectTrigger className="w-full sm:w-[180px] h-8 rounded-md text-xs px-3 text-white border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground">
                <SelectValue placeholder="Time Window" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5m">Last 5 Minutes</SelectItem>
                <SelectItem value="15m">Last 15 Minutes</SelectItem>
                <SelectItem value="30m">Last 30 Minutes</SelectItem>
                <SelectItem value="1h">Last 1 Hour</SelectItem>
                <SelectItem value="custom">Custom Range...</SelectItem>
              </SelectContent>
            </Select>
            {timeWindow === 'custom' && customTimeRange && (
              <Button variant="outline" size="sm" onClick={() => setShowCustomTimeDialog(true)} className="text-white w-full sm:w-auto">
                <Clock className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">{format(customTimeRange.start, 'MMM d HH:mm')} - {format(customTimeRange.end, 'HH:mm')}</span>
                <span className="sm:hidden">Custom Range</span>
              </Button>
            )}
            <SchemaDropdown onAddNew={() => setShowSchemaModal(true)} />
          </div>
        </div>

        {devicesWithCharts.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground space-y-2">
                <p className="text-lg font-medium">Waiting for sensor data...</p>
                <p className="text-sm">
                  Charts will automatically appear when sensor headers are detected.
                </p>
                <p className="text-xs mt-4">
                  Click "Add Custom Schema" above to define custom sensor formats.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd} onDragUpdate={onDragUpdate}>
            <Droppable droppableId="charts">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-4 relative"
                >
                  {orderedChartKeys
                    .map(key => allCharts.get(key))
                    .filter(Boolean)
                    .map((chartData, index) => {
                      const key = isMergedChart(chartData!) ? chartData!.id : `${(chartData as DeviceChartData).hubId}:${(chartData as DeviceChartData).portId}`;
                      const isDragging = draggedIndex === index;
                      const isDropTarget = dropTargetIndex === index && draggedIndex !== null && draggedIndex !== index;

                      return (
                        <div key={key} className="relative">
                          {/* Blue position indicator */}
                          {isDropTarget && (
                            <div className={`absolute left-0 right-0 h-1 ${shiftPressed ? 'bg-purple-500' : 'bg-cyan-500'} rounded-full z-10 transition-colors ${
                              dropTargetIndex! < draggedIndex! ? '-top-2' : '-bottom-2'
                            }`}>
                              {shiftPressed && (
                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-purple-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                                  Merge with {isMergedChart(chartData!) ? 'chart' : (chartData as DeviceChartData).sensorName}
                                </div>
                              )}
                            </div>
                          )}
                          <Draggable key={key} draggableId={key} index={index}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={isDragging ? 'opacity-30' : ''}
                                style={provided.draggableProps.style}
                              >
                                <DeviceChart
                                  data={chartData!}
                                  dragHandleProps={provided.dragHandleProps}
                                  onSeparate={handleSeparateChart}
                                  isDragOver={isDropTarget && shiftPressed}
                                />
                              </div>
                            )}
                          </Draggable>
                        </div>
                      );
                    })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      {/* Custom Time Range Dialog */}
      <Dialog open={showCustomTimeDialog} onOpenChange={setShowCustomTimeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-foreground">Custom Time Range</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-foreground">Start Date & Time</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="flex-1 text-foreground [&::-webkit-calendar-picker-indicator]:invert"
                />
                <Input
                  type="time"
                  value={customStartTime}
                  onChange={(e) => setCustomStartTime(e.target.value)}
                  className="flex-1 text-foreground [&::-webkit-calendar-picker-indicator]:invert"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">End Date & Time</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="flex-1 text-foreground [&::-webkit-calendar-picker-indicator]:invert"
                />
                <Input
                  type="time"
                  value={customEndTime}
                  onChange={(e) => setCustomEndTime(e.target.value)}
                  className="flex-1 text-foreground [&::-webkit-calendar-picker-indicator]:invert"
                />
              </div>
            </div>
            <Button onClick={applyCustomTimeRange} className="w-full">
              Apply Time Range
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Chart Schema Modal */}
      <ChartSchemaModal
        open={showSchemaModal}
        onOpenChange={setShowSchemaModal}
        onSave={handleSaveSchema}
      />
    </div>
  );
}
