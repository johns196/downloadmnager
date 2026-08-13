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
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
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
              IconButton(
                icon: const Icon(Icons.delete_outline),
                tooltip: "Delete",
                onPressed: () async {
                  final store = context.read<DownloadStore>();
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text("Delete download?"),
                      content: Text('"${job.filename}" will be removed from disk. This can\'t be undone.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Cancel")),
                        TextButton(onPressed: () => Navigator.pop(context, true), child: const Text("Delete")),
                      ],
                    ),
                  );
                  if (confirmed != true) return;
                  try {
                    // Library entries are finished files the user is
                    // actively browsing, not an in-progress queue -- unlike
                    // DownloadCard's generic remove (which keeps a
                    // completed file on disk and only clears the list
                    // entry), deleting here is expected to actually free
                    // the disk space, which is the whole point of exposing
                    // it from this screen (duplicate-cleanup was the
                    // motivating case).
                    await store.remove(job.id, deleteFile: true);
                  } on ApiException catch (err) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text("Could not delete: ${err.message}")),
                      );
                    }
                  }
                },
              ),
            ],
          ),
        );
      },
    );
  }
}
