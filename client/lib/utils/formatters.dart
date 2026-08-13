String formatBytes(int? bytes) {
  if (bytes == null) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  double value = bytes.toDouble();
  int unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return "${value.toStringAsFixed(unitIndex == 0 ? 0 : 1)} ${units[unitIndex]}";
}

String formatSpeed(double bytesPerSec) {
  if (bytesPerSec <= 0) return "0 B/s";
  return "${formatBytes(bytesPerSec.round())}/s";
}

String formatEta(int? seconds) {
  if (seconds == null || seconds <= 0) return "--";
  final d = Duration(seconds: seconds);
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  final s = d.inSeconds.remainder(60);
  if (h > 0) return "${h}h ${m}m";
  if (m > 0) return "${m}m ${s}s";
  return "${s}s";
}

String formatPercent(double fraction) => "${(fraction.clamp(0, 1) * 100).toStringAsFixed(0)}%";
