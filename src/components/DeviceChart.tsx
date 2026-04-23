import { useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Download, GripVertical, Split, Layers } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { ChartData, DeviceChartData, MergedChartData } from '@/types';
import { isMergedChart } from '@/types';
import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface DeviceChartProps {
  data: ChartData;
  dragHandleProps?: DraggableProvidedDragHandleProps;
  onSeparate?: (chartId: string) => void;
  isDragOver?: boolean;
}

interface ChartRow {
  timestamp: number;
  time: string;
  [key: string]: number | string;
}

export function DeviceChart({ data, dragHandleProps, onSeparate, isDragOver }: DeviceChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  const mergedChartData: MergedChartData | undefined = isMergedChart(data) ? data : undefined;
  const sources = useMemo<DeviceChartData[]>(
    () => (mergedChartData ? mergedChartData.sources : [data as DeviceChartData]),
    [mergedChartData, data]
  );
  const allFields = useMemo(() => 
    sources.flatMap(source => 
      source.fields.map(field => ({
        ...field,
        // Prefix field names with source identifier if merged
        displayName: mergedChartData ? `${source.sensorName} - ${field.fieldName}` : field.fieldName,
        originalName: field.fieldName,
        sourceId: `${source.hubId}:${source.portId}`
      }))
    ),
    [sources, mergedChartData]
  );

  const handleSeparate = () => {
    if (mergedChartData && onSeparate) {
      onSeparate(mergedChartData.id);
    }
  };

  // Convert chart data to format expected by Recharts - memoized to prevent infinite loops
  const chartData = useMemo<ChartRow[]>(() => {
    const result: ChartRow[] = [];
    const timestamps = new Set<number>();
    
    // Collect all unique timestamps
    allFields.forEach(field => {
      field.data.forEach(point => {
        timestamps.add(point.timestamp);
      });
    });

    // Sort timestamps
    const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);

    // Build data points for each timestamp
    sortedTimestamps.forEach(timestamp => {
      const point: ChartRow = {
        timestamp,
        time: new Date(timestamp).toLocaleTimeString(),
      };

      allFields.forEach(field => {
        const dataPoint = field.data.find(d => d.timestamp === timestamp);
        if (dataPoint) {
          point[field.displayName] = dataPoint.value;
        }
      });

      result.push(point);
    });

    return result;
  }, [allFields]);

  if (!allFields.length || !allFields.some(f => f.data.length > 0)) {
    return null;
  }

  const downloadCSV = () => {
    const headers = ['Time', ...allFields.map(f => `${f.displayName} (${f.unit})`)];
    const rows = chartData.map(point => [
      new Date(point.timestamp).toISOString(),
      ...allFields.map(f => point[f.displayName] ?? '')
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const deviceData = data as DeviceChartData;
    const fileName = mergedChartData
      ? `merged_chart_${mergedChartData.id}_${Date.now()}.csv`
      : `${deviceData.sensorName}_${deviceData.hubId}_${deviceData.portId}_${Date.now()}.csv`;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadImage = async (format: 'png' | 'jpg') => {
    if (!chartRef.current) return;
    
    const canvas = await html2canvas(chartRef.current, {
      backgroundColor: format === 'jpg' ? '#ffffff' : null,
      scale: 2
    });
    
    const url = canvas.toDataURL(`image/${format}`);
    const a = document.createElement('a');
    a.href = url;
    const imageFileName = mergedChartData
      ? `merged_chart_${mergedChartData.id}_${Date.now()}.${format}`
      : `${(data as DeviceChartData).sensorName}_${(data as DeviceChartData).hubId}_${(data as DeviceChartData).portId}_${Date.now()}.${format}`;
    a.download = imageFileName;
    a.click();
  };

  const downloadPDF = async () => {
    if (!chartRef.current) return;
    
    const canvas = await html2canvas(chartRef.current, {
      backgroundColor: '#ffffff',
      scale: 2
    });
    
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height]
    });
    
    pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    const pdfFileName = mergedChartData
      ? `merged_chart_${mergedChartData.id}_${Date.now()}.pdf`
      : `${(data as DeviceChartData).sensorName}_${(data as DeviceChartData).hubId}_${(data as DeviceChartData).portId}_${Date.now()}.pdf`;
    pdf.save(pdfFileName);
  };

  return (
    <Card 
      ref={chartRef} 
      className={isDragOver ? 'ring-2 ring-purple-500 ring-offset-2 bg-purple-500/10' : ''}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            {dragHandleProps && (
              <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing">
                <GripVertical className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {mergedChartData ? (
                <>
                  <Layers className="h-4 w-4 text-cyan-400" />
                  <CardTitle className="text-lg">Merged Chart</CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {sources.length} sources
                  </Badge>
                </>
              ) : (
                <CardTitle className="text-lg">
                  {(data as DeviceChartData).sensorName} - {(data as DeviceChartData).hubId}:{(data as DeviceChartData).portId}
                </CardTitle>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mergedChartData && onSeparate && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleSeparate}
                className="hover:bg-destructive/10 hover:text-destructive"
              >
                <Split className="h-4 w-4 mr-2" />
                Separate
              </Button>
            )}
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={downloadCSV}>
                Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadImage('png')}>
                Download PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadImage('jpg')}>
                Download JPG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadPDF}>
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="time" 
              tick={{ fontSize: 12 }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(0, 0, 0, 0.8)', 
                border: '1px solid #333',
                borderRadius: '4px'
              }}
            />
            <Legend />
            {allFields.map(field => (
              <Line
                key={`${field.sourceId}-${field.originalName}`}
                type="monotone"
                dataKey={field.displayName}
                stroke={field.color}
                strokeWidth={2}
                dot={false}
                name={`${field.displayName} (${field.unit})`}
                animationDuration={0}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
