import "package:flutter/material.dart";
import "package:provider/provider.dart";
import "package:url_launcher/url_launcher.dart";

import "../models/download_job.dart";
import "../services/api_client.dart";
import "../state/download_store.dart";
import "../utils/formatters.dart";

/// Completed downloads -- browse and stream/play grabbed music & video.
/// Playback goes through the backend's static file server
/// (GET /downloads/:filename, see docs/API.md) rather than a raw file://
/// path so this works identically on desktop and mobile.
class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DownloadStore>();
    final api = context.read<ApiClient>();
    final items = store.completed;

    if (items.isEmpty) {
      return const Center(child: Text("No completed downloads yet"));
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final job = items[index];
        return ListTile(
          leading: Icon(job.mediaKind == MediaKind.audio ? Icons.music_note : Icons.movie),
          title: Text(job.filename, overflow: TextOverflow.ellipsis),
          subtitle: Text("${formatBytes(job.sizeBytes)} · completed ${job.completedAt?.toLocal() ?? ""}"),
          trailing: IconButton(
            icon: const Icon(Icons.play_arrow),
            tooltip: "Play / open",
            onPressed: () async {
              final uri = Uri.parse(api.downloadUrlFor(job));
              if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text("Could not open ${job.filename}")),
                  );
                }
              }
            },
          ),
        );
      },
    );
  }
}
