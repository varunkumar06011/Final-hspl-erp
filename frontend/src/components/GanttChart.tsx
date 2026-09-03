import { useMemo, useState } from 'react';
import { Box, Typography, Card, CardContent, Tooltip, CircularProgress, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { useColorMode } from '../config/ColorModeContext';

interface Activity {
  id: string;
  name: string;
  status: string;
  progressPercent: number;
  plannedStart: string | null;
  plannedEnd: string | null;
}

interface Phase {
  id: string;
  name: string;
  status: string;
  progressPercent: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  activities: Activity[];
}

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: '#9E9E9E',
  IN_PROGRESS: '#FF9800',
  COMPLETED: '#4CAF50',
  ON_HOLD: '#F44336',
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
};

type ViewMode = 'phases' | 'activities';

export default function GanttChart() {
  const { mode } = useColorMode();
  const [viewMode, setViewMode] = useState<ViewMode>('phases');
  const textColor = mode === 'dark' ? '#ddd' : '#333';
  const gridColor = mode === 'dark' ? '#333' : '#e0e0e0';
  const weekendColor = mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';

  const { data, isLoading } = useQuery({
    queryKey: ['/phases', 'gantt'],
    queryFn: async () => {
      const response = await api.get('/phases', { params: { pageSize: 100 } });
      return response.data;
    },
  });

  const phases: Phase[] = data?.data ?? [];

  // Build flat list of rows based on view mode
  const rows = useMemo(() => {
    if (viewMode === 'phases') {
      return phases.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        progress: Number(p.progressPercent ?? 0),
        start: p.plannedStart,
        end: p.plannedEnd,
        isPhase: true,
      }));
    }
    // Activities view: show phase as a group header + its activities
    const result: { id: string; name: string; status: string; progress: number; start: string | null; end: string | null; isPhase: boolean }[] = [];
    for (const phase of phases) {
      result.push({
        id: phase.id,
        name: phase.name,
        status: phase.status,
        progress: Number(phase.progressPercent ?? 0),
        start: phase.plannedStart,
        end: phase.plannedEnd,
        isPhase: true,
      });
      for (const act of phase.activities) {
        result.push({
          id: act.id,
          name: act.name,
          status: act.status,
          progress: Number(act.progressPercent ?? 0),
          start: act.plannedStart,
          end: act.plannedEnd,
          isPhase: false,
        });
      }
    }
    return result;
  }, [phases, viewMode]);

  // Calculate date range
  const { minDate, totalDays } = useMemo(() => {
    const dates: number[] = [];
    for (const row of rows) {
      if (row.start) dates.push(new Date(row.start).getTime());
      if (row.end) dates.push(new Date(row.end).getTime());
    }
    if (dates.length === 0) {
      const now = Date.now();
      return { minDate: now, maxDate: now + 30 * 86400000, totalDays: 30 };
    }
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    // Add padding
    const paddedMin = min - 2 * 86400000;
    const paddedMax = max + 2 * 86400000;
    return { minDate: paddedMin, totalDays: Math.ceil((paddedMax - paddedMin) / 86400000) };
  }, [rows]);

  const rowHeight = 32;
  const labelWidth = 200;
  const dayWidth = Math.max(8, Math.min(40, 800 / Math.max(totalDays, 1)));
  const chartWidth = totalDays * dayWidth;
  const totalHeight = rows.length * rowHeight + 40;

  function dateToX(timestamp: number): number {
    return ((timestamp - minDate) / 86400000) * dayWidth;
  }

  // Generate week markers
  const weekMarkers = useMemo(() => {
    const markers: { x: number; label: string; isWeekend: boolean }[] = [];
    const start = new Date(minDate);
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const x = dateToX(d.getTime());
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      if (i % 7 === 0 || i === totalDays) {
        markers.push({
          x,
          label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
          isWeekend,
        });
      }
    }
    return markers;
  }, [minDate, totalDays, dayWidth]);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <Box>
            <Typography variant="h6">Project Timeline</Typography>
            <Typography variant="body2" color="text.secondary">
              Visual Gantt chart of phases and activities
            </Typography>
          </Box>
          <ToggleButtonGroup
            size="small"
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
          >
            <ToggleButton value="phases">Phases</ToggleButton>
            <ToggleButton value="activities">Activities</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            No phases or activities with dates yet.
          </Typography>
        ) : (
          <Box sx={{ width: '100%', overflowX: 'auto' }}>
            <svg width={labelWidth + chartWidth + 20} height={totalHeight} style={{ minWidth: '100%' }}>
              {/* Weekend background bands */}
              {weekMarkers.map((m, i) => {
                if (!m.isWeekend) return null;
                return <rect key={`we-${i}`} x={m.x} y={0} width={dayWidth} height={totalHeight} fill={weekendColor} />;
              })}

              {/* Week grid lines + labels */}
              {weekMarkers.map((m, i) => (
                <g key={`grid-${i}`}>
                  <line x1={m.x + labelWidth} y1={0} x2={m.x + labelWidth} y2={totalHeight} stroke={gridColor} strokeWidth={1} />
                  <text x={m.x + labelWidth + 4} y={14} fill={textColor} fontSize={10}>
                    {m.label}
                  </text>
                </g>
              ))}

              {/* Rows */}
              {rows.map((row, idx) => {
                const y = idx * rowHeight + 30;
                const rowBg = idx % 2 === 0
                  ? (mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)')
                  : 'transparent';

                if (!row.start || !row.end) {
                  return (
                    <g key={row.id}>
                      <rect x={0} y={y} width={labelWidth + chartWidth} height={rowHeight} fill={rowBg} />
                      <text x={8} y={y + rowHeight / 2 + 4} fill={textColor} fontSize={11} fontWeight={row.isPhase ? 600 : 400}>
                        {row.isPhase ? '📁 ' : '   '}{row.name}
                      </text>
                      <text x={labelWidth + 10} y={y + rowHeight / 2 + 4} fill={textColor} fontSize={10} opacity={0.5}>
                        No dates
                      </text>
                    </g>
                  );
                }

                const startX = dateToX(new Date(row.start).getTime()) + labelWidth;
                const endX = dateToX(new Date(row.end).getTime()) + labelWidth;
                const barWidth = Math.max(4, endX - startX);
                const progressWidth = (barWidth * row.progress) / 100;
                const color = STATUS_COLORS[row.status] ?? STATUS_COLORS.NOT_STARTED;

                return (
                  <g key={row.id}>
                    {/* Row background */}
                    <rect x={0} y={y} width={labelWidth + chartWidth} height={rowHeight} fill={rowBg} />

                    {/* Label */}
                    <Tooltip
                      title={`${row.name} — ${STATUS_LABELS[row.status] ?? row.status} (${row.progress}%)`}
                      arrow
                    >
                      <text
                        x={8}
                        y={y + rowHeight / 2 + 4}
                        fill={textColor}
                        fontSize={11}
                        fontWeight={row.isPhase ? 600 : 400}
                      >
                        {row.isPhase ? '📁 ' : '   '}{row.name.length > 25 ? row.name.slice(0, 23) + '…' : row.name}
                      </text>
                    </Tooltip>

                    {/* Bar background */}
                    <rect
                      x={startX}
                      y={y + 6}
                      width={barWidth}
                      height={rowHeight - 12}
                      rx={4}
                      fill={color}
                      opacity={0.3}
                    />

                    {/* Progress fill */}
                    <rect
                      x={startX}
                      y={y + 6}
                      width={progressWidth}
                      height={rowHeight - 12}
                      rx={4}
                      fill={color}
                    />

                    {/* Progress text */}
                    {barWidth > 40 && (
                      <text
                        x={startX + barWidth / 2}
                        y={y + rowHeight / 2 + 4}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={9}
                        fontWeight={600}
                      >
                        {row.progress}%
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </Box>
        )}

        {/* Legend */}
        {!isLoading && rows.length > 0 && (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1, justifyContent: 'center' }}>
            {Object.entries(STATUS_COLORS).map(([status, color]) => (
              <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: 1, bgcolor: color, opacity: 0.7 }} />
                <Typography variant="caption" color="text.secondary">
                  {STATUS_LABELS[status] ?? status}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
