import "package:fl_chart/fl_chart.dart";
import "package:flutter/material.dart";

/// Rolling sparkline of recent speed samples (bytes/sec), fed by
/// DownloadStore.speedHistoryFor(jobId) which is updated on every
/// job:update WebSocket event -- no polling.
class SpeedGraph extends StatelessWidget {
  final List<double> samples;
  final double height;

  const SpeedGraph({super.key, required this.samples, this.height = 40});

  @override
  Widget build(BuildContext context) {
    if (samples.length < 2) {
      return SizedBox(height: height);
    }
    final maxY = samples.reduce((a, b) => a > b ? a : b);
    final color = Theme.of(context).colorScheme.primary;

    return SizedBox(
      height: height,
      child: LineChart(
        LineChartData(
          minY: 0,
          maxY: maxY <= 0 ? 1 : maxY * 1.15,
          gridData: const FlGridData(show: false),
          titlesData: const FlTitlesData(show: false),
          borderData: FlBorderData(show: false),
          lineTouchData: const LineTouchData(enabled: false),
          lineBarsData: [
            LineChartBarData(
              spots: [for (int i = 0; i < samples.length; i++) FlSpot(i.toDouble(), samples[i])],
              isCurved: true,
              color: color,
              barWidth: 2,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(show: true, color: color.withOpacity(0.15)),
            ),
          ],
        ),
        duration: Duration.zero,
      ),
    );
  }
}
