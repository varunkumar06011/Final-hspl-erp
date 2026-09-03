import { Box, Typography, Card, CardContent, Tooltip } from '@mui/material';
import { useMemo, useState } from 'react';
import { formatCurrency } from '../utils/enumOptions';
import { useColorMode } from '../config/ColorModeContext';

interface FlowNode {
  id: string;
  label: string;
  value: number;
  color: string;
  x: number;
  _h: number;
  _y: number;
}

interface FlowLink {
  source: string;
  target: string;
  value: number;
  color: string;
}

interface MoneyFlowSankeyProps {
  totalBudget: number;
  committed: number;
  paid: number;
}

/**
 * Custom SVG-based Sankey diagram showing money flow:
 *   Total Budget → Committed (POs) → Paid
 *                                → Unpaid (Outstanding)
 *   Total Budget → Remaining
 */
export default function MoneyFlowSankey({ totalBudget, committed, paid }: MoneyFlowSankeyProps) {
  const { mode } = useColorMode();
  const [hovered, setHovered] = useState<string | null>(null);

  const isDark = mode === 'dark';
  const textColor = isDark ? '#ddd' : '#333';

  const unpaid = Math.max(0, committed - paid);
  const remaining = Math.max(0, totalBudget - committed);

  const width = 700;
  const height = 320;
  const nodePadding = 20;
  const nodeWidth = 140;
  const labelOffset = 10;

  // Calculate node heights proportional to value
  const maxValue = Math.max(totalBudget, 1);
  const availableHeight = height - nodePadding * 4;

  const nodes: FlowNode[] = useMemo(() => {
    const budgetHeight = Math.max(20, (totalBudget / maxValue) * availableHeight);
    const committedHeight = Math.max(20, (committed / maxValue) * availableHeight);
    const paidHeight = Math.max(15, (paid / maxValue) * availableHeight);
    const unpaidHeight = Math.max(15, (unpaid / maxValue) * availableHeight);
    const remainingHeight = Math.max(15, (remaining / maxValue) * availableHeight);

    const col1X = 20;
    const col2X = 270;
    const col3X = 520;

    // Column 1: Budget (centered vertically)
    const budgetY = (height - budgetHeight) / 2;

    // Column 2: Committed (top) + Remaining (bottom)
    const col2Total = committedHeight + remainingHeight + nodePadding;
    const col2StartY = (height - col2Total) / 2;
    const committedY = col2StartY;
    const remainingY = col2StartY + committedHeight + nodePadding;

    // Column 3: Paid (top) + Unpaid (bottom)
    const col3Total = paidHeight + unpaidHeight + nodePadding;
    const col3StartY = (height - col3Total) / 2;
    const paidY = col3StartY;
    const unpaidY = col3StartY + paidHeight + nodePadding;

    return [
      { id: 'budget', label: 'Total Budget', value: totalBudget, color: '#2196F3', x: col1X, _h: budgetHeight, _y: budgetY },
      { id: 'committed', label: 'Committed', value: committed, color: '#FF9800', x: col2X, _h: committedHeight, _y: committedY },
      { id: 'remaining', label: 'Remaining', value: remaining, color: '#4CAF50', x: col2X, _h: remainingHeight, _y: remainingY },
      { id: 'paid', label: 'Paid', value: paid, color: '#66BB6A', x: col3X, _h: paidHeight, _y: paidY },
      { id: 'unpaid', label: 'Outstanding', value: unpaid, color: '#EF5350', x: col3X, _h: unpaidHeight, _y: unpaidY },
    ];
  }, [totalBudget, committed, paid, unpaid, remaining, maxValue]);

  const nodeMap = useMemo(() => {
    const map: Record<string, FlowNode> = {};
    nodes.forEach((n) => { map[n.id] = n; });
    return map;
  }, [nodes]);

  const links: FlowLink[] = [
    { source: 'budget', target: 'committed', value: committed, color: '#FF9800' },
    { source: 'budget', target: 'remaining', value: remaining, color: '#4CAF50' },
    { source: 'committed', target: 'paid', value: paid, color: '#66BB6A' },
    { source: 'committed', target: 'unpaid', value: unpaid, color: '#EF5350' },
  ];

  // Generate SVG path for a Sankey flow link (curved bezier)
  function linkPath(sourceId: string, targetId: string, sourceVal: number): string {
    const s = nodeMap[sourceId];
    const t = nodeMap[targetId];
    if (!s || !t) return '';

    const sx = s.x + nodeWidth;
    const tx = t.x;
    const gap = tx - sx;

    // Source node: flow starts from top or bottom portion
    // For simplicity, flow occupies the full height of the source node
    const sY1 = s._y;
    const sY2 = s._y + s._h;
    const tY1 = t._y;
    const tY2 = t._y + t._h;

    // Proportional offset within the source node
    const sRatio = sourceVal / Math.max(s.value, 1);

    // For multi-link nodes, stack flows
    let sOffsetTop = 0;
    let sOffsetBottom = 0;
    let tOffsetTop = 0;
    let tOffsetBottom = 0;

    if (sourceId === 'budget' && targetId === 'committed') {
      sOffsetTop = 0;
      sOffsetBottom = s._h * (1 - sRatio);
    } else if (sourceId === 'budget' && targetId === 'remaining') {
      sOffsetTop = s._h * (committed / Math.max(totalBudget, 1));
      sOffsetBottom = 0;
    } else if (sourceId === 'committed' && targetId === 'paid') {
      sOffsetTop = 0;
      sOffsetBottom = s._h * (1 - sRatio);
    } else if (sourceId === 'committed' && targetId === 'unpaid') {
      sOffsetTop = s._h * (paid / Math.max(committed, 1));
      sOffsetBottom = 0;
    }

    const finalSY1 = sY1 + sOffsetTop;
    const finalSY2 = sY2 - sOffsetBottom;
    const finalTY1 = tY1 + tOffsetTop;
    const finalTY2 = tY2 - tOffsetBottom;

    const midX = sx + gap / 2;

    return `M ${sx} ${finalSY1}
            C ${midX} ${finalSY1}, ${midX} ${finalTY1}, ${tx} ${finalTY1}
            L ${tx} ${finalTY2}
            C ${midX} ${finalTY2}, ${midX} ${finalSY2}, ${sx} ${finalSY2}
            Z`;
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Money Flow</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          How your budget flows through commitments to payments
        </Typography>
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <svg width={width} height={height} style={{ maxWidth: '100%' }}>
            {/* Links */}
            {links.map((link) => {
              const path = linkPath(link.source, link.target, link.value);
              const isHovered = hovered === `${link.source}-${link.target}`;
              return (
                <Tooltip
                  key={`${link.source}-${link.target}`}
                  title={`${nodeMap[link.source]?.label} → ${nodeMap[link.target]?.label}: ${formatCurrency(link.value)}`}
                  arrow
                >
                  <path
                    d={path}
                    fill={link.color}
                    opacity={hovered && !isHovered ? 0.15 : isHovered ? 0.6 : 0.35}
                    style={{ transition: 'opacity 0.2s', cursor: 'pointer' }}
                    onMouseEnter={() => setHovered(`${link.source}-${link.target}`)}
                    onMouseLeave={() => setHovered(null)}
                  />
                </Tooltip>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const isHovered = hovered?.includes(node.id);
              return (
                <g
                  key={node.id}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <Tooltip
                    title={`${node.label}: ${formatCurrency(node.value)}`}
                    arrow
                  >
                    <rect
                      x={node.x}
                      y={node._y}
                      width={nodeWidth}
                      height={node._h}
                      rx={6}
                      fill={node.color}
                      opacity={isHovered ? 1 : 0.85}
                      style={{ transition: 'opacity 0.2s' }}
                    />
                  </Tooltip>
                  {/* Label */}
                  <text
                    x={node.x + nodeWidth / 2}
                    y={node._y - labelOffset}
                    textAnchor="middle"
                    fill={textColor}
                    fontSize={12}
                    fontWeight={600}
                  >
                    {node.label}
                  </text>
                  {/* Value */}
                  <text
                    x={node.x + nodeWidth / 2}
                    y={node._y + node._h / 2 + 4}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={11}
                    fontWeight={600}
                  >
                    ₹{Math.round(node.value).toLocaleString('en-IN')}
                  </text>
                </g>
              );
            })}
          </svg>
        </Box>
        {/* Legend */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1, justifyContent: 'center' }}>
          {nodes.map((node) => (
            <Box key={node.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 2, bgcolor: node.color }} />
              <Typography variant="caption" color="text.secondary">
                {node.label}: {formatCurrency(node.value)}
              </Typography>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
