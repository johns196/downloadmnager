import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../models/download_job.dart";
import "../state/download_store.dart";
import "../utils/formatters.dart";
import "speed_graph.dart";
import "status_badge.dart";

class DownloadCard extends StatelessWidget {
  final DownloadJob job;
  const DownloadCard({super.key, required this.job});

  IconData _mediaIcon() {
    switch (job.mediaKind) {
      case MediaKind.audio:
        return Icons.music_note;
      case MediaKind.video:
        return Icons.movie;
      case MediaKind.file:
        return Icons.insert_drive_file;
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DownloadStore>();
    final history = store.speedHistoryFor(job.id);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(_mediaIcon(), size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    job.filename,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(width: 8),
                StatusBadge(state: job.state),
              ],
            ),
            const SizedBox(height: 8),
            if (job.state == JobState.active || job.state == JobState.paused) ...[
              LinearProgressIndicator(value: job.sizeBytes != null ? job.progress : null),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "${formatBytes(job.downloadedBytes)} / ${formatBytes(job.sizeBytes)}",
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  Text(formatSpeed(job.speedBytesPerSec), style: Theme.of(context).textTheme.bodySmall),
                  Text("ETA ${formatEta(job.etaSeconds)}", style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
              if (job.state == JobState.active && history.isNotEmpty) ...[
                const SizedBox(height: 6),
                SpeedGraph(samples: history),
              ],
            ],
            if (job.state == JobState.completed)
              Text(
                "${formatBytes(job.sizeBytes)} · sha256 ${job.sha256?.substring(0, 12) ?? "--"}...",
                style: Theme.of(context).textTheme.bodySmall,
              ),
            if (job.state == JobState.error)
              Text(
                job.error ?? "Unknown error",
                style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12),
              ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (job.state == JobState.active)
                  IconButton(
                    icon: const Icon(Icons.pause),
                    tooltip: "Pause",
                    onPressed: () => store.pause(job.id),
                  ),
                if (job.state == JobState.paused || job.state == JobState.error)
                  IconButton(
                    icon: const Icon(Icons.play_arrow),
                    tooltip: "Resume",
                    onPressed: () => store.resume(job.id),
                  ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: "Remove",
                  onPressed: () => store.remove(job.id, deleteFile: job.state != JobState.completed),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
