import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../models/download_job.dart";
import "../models/stream_descriptor.dart";
import "../services/api_client.dart";
import "../state/download_store.dart";

/// Lets the user paste any page URL and have the sniffer-service (via the
/// backend's POST /api/sniff) find grabbable audio/video streams on it --
/// the manual equivalent of the browser extension's floating panel.
class SnifferScreen extends StatefulWidget {
  const SnifferScreen({super.key});

  @override
  State<SnifferScreen> createState() => _SnifferScreenState();
}

class _SnifferScreenState extends State<SnifferScreen> {
  final _urlController = TextEditingController();
  bool _loading = false;
  String? _error;
  SniffResult? _result;

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _sniff() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
      _result = null;
    });
    try {
      final result = await context.read<ApiClient>().sniff(url);
      setState(() => _result = result);
    } catch (err) {
      setState(() => _error = err.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _grab(StreamDescriptor stream, {bool extractAudio = false}) async {
    final url = _urlController.text.trim();
    try {
      await context.read<ApiClient>().grabStream(
            url,
            stream.id,
            postProcess: extractAudio
                ? PostProcessSpec(
                    action: PostProcessAction.extractAudio,
                    targetContainer: TargetContainer.mp3,
                    tags: PostProcessTags(title: stream.title),
                  )
                : null,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Queued for download")));
        await context.read<DownloadStore>().refresh();
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Error: $err")));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _urlController,
                  decoration: const InputDecoration(
                    labelText: "Page URL",
                    hintText: "https://example.com/watch?v=...",
                  ),
                  onSubmitted: (_) => _sniff(),
                ),
              ),
              const SizedBox(width: 12),
              FilledButton(
                onPressed: _loading ? null : _sniff,
                child: _loading
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text("Sniff"),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (_error != null)
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (_result != null) Expanded(child: _buildResults(_result!)),
        ],
      ),
    );
  }

  Widget _buildResults(SniffResult result) {
    if (result.streams.isEmpty) {
      return Center(
        child: Text(
          result.warnings.isNotEmpty ? result.warnings.join("\n") : "No media found on this page.",
          textAlign: TextAlign.center,
        ),
      );
    }
    return ListView(
      children: [
        for (final w in result.warnings)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(w, style: Theme.of(context).textTheme.bodySmall),
          ),
        for (final stream in result.streams)
          Card(
            child: ListTile(
              leading: Icon(stream.isAudioOnly ? Icons.music_note : Icons.movie),
              title: Text(stream.title ?? result.pageTitle ?? stream.url, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                [
                  stream.protocol.name,
                  if (stream.container != null) stream.container!,
                  if (stream.resolution != null) stream.resolution!,
                  if (stream.bitrateKbps != null) "${stream.bitrateKbps!.round()}kbps",
                ].join(" · "),
              ),
              trailing: Wrap(
                spacing: 4,
                children: [
                  IconButton(
                    icon: const Icon(Icons.download),
                    tooltip: "Download",
                    onPressed: () => _grab(stream),
                  ),
                  if (!stream.isAudioOnly)
                    IconButton(
                      icon: const Icon(Icons.audiotrack),
                      tooltip: "Extract audio (MP3)",
                      onPressed: () => _grab(stream, extractAudio: true),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
