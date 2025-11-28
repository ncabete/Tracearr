import { useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import type { PlayStats } from '@tracearr/shared';
import { ChartSkeleton } from '@/components/ui/skeleton';

interface PlaysChartProps {
  data: PlayStats[] | undefined;
  isLoading?: boolean;
  height?: number;
}

export function PlaysChart({ data, isLoading, height = 200 }: PlaysChartProps) {
  const options = useMemo<Highcharts.Options>(() => {
    if (!data || data.length === 0) {
      return {};
    }

    return {
      chart: {
        type: 'area',
        height,
        backgroundColor: 'transparent',
        style: {
          fontFamily: 'inherit',
        },
      },
      title: {
        text: undefined,
      },
      credits: {
        enabled: false,
      },
      legend: {
        enabled: false,
      },
      xAxis: {
        type: 'datetime',
        categories: data.map((d) => d.date),
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
          format: '{value:%b %d}',
        },
        lineColor: 'hsl(var(--border))',
        tickColor: 'hsl(var(--border))',
      },
      yAxis: {
        title: {
          text: undefined,
        },
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
        },
        gridLineColor: 'hsl(var(--border))',
        min: 0,
      },
      plotOptions: {
        area: {
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'hsl(var(--primary) / 0.3)'],
              [1, 'hsl(var(--primary) / 0.05)'],
            ],
          },
          marker: {
            enabled: false,
            states: {
              hover: {
                enabled: true,
                radius: 4,
              },
            },
          },
          lineWidth: 2,
          lineColor: 'hsl(var(--primary))',
          states: {
            hover: {
              lineWidth: 2,
            },
          },
          threshold: null,
        },
      },
      tooltip: {
        backgroundColor: 'hsl(var(--popover))',
        borderColor: 'hsl(var(--border))',
        style: {
          color: 'hsl(var(--popover-foreground))',
        },
        formatter: function () {
          return `<b>${this.x}</b><br/>Plays: ${this.y}`;
        },
      },
      series: [
        {
          type: 'area',
          name: 'Plays',
          data: data.map((d) => d.count),
        },
      ],
    };
  }, [data, height]);

  if (isLoading) {
    return <ChartSkeleton height={height} />;
  }

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-muted-foreground"
        style={{ height }}
      >
        No play data available
      </div>
    );
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />;
}
