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

  Future<void> _grab(StreamDescriptor stream, {PostProcessSpec? postProcess}) async {
    final url = _urlController.text.trim();
    try {
      await context.read<ApiClient>().grabStream(url, stream.id, postProcess: postProcess);
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
        for (final stream in result.streams) _buildStreamCard(context, stream, result),
      ],
    );
  }

  Widget _buildStreamCard(BuildContext context, StreamDescriptor stream, SniffResult result) {
    // "yt-dlp-merge" is the synthetic entry the sniffer-service adds when
    // a site only offers separate silent-video + audio-only formats
    // (near-universal on modern YouTube above ~360p) -- grabbing it
    // downloads+muxes both via yt-dlp itself (QueueManager.
    // createYtdlpMergeJob), producing one real playable file. Highlighted
    // since it's the answer to "just give me the movie" that no single
    // raw format below it can provide alone.
    final isMerge = stream.extractor == "yt-dlp-merge";
    final noAudio = !isMerge && !stream.isAudioOnly && !stream.hasAudio;

    return Card(
      color: isMerge ? Theme.of(context).colorScheme.primaryContainer : null,
      child: ListTile(
        leading: Icon(stream.isAudioOnly ? Icons.music_note : Icons.movie),
        title: Text(stream.title ?? result.pageTitle ?? stream.url, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          isMerge
              ? "Best quality · video + audio merged · mp4"
              : [
                  stream.protocol.name,
                  if (stream.container != null) stream.container!,
                  if (stream.resolution != null) stream.resolution!,
                  if (stream.bitrateKbps != null) "${stream.bitrateKbps!.round()}kbps",
                  // A video-only DASH stream (no acodec at all) downloads
                  // as a silent file -- easy to not notice until
                  // playback, so called out explicitly.
                  if (noAudio) "⚠ no audio",
                ].join(" · "),
        ),
        trailing: Wrap(
          spacing: 4,
          children: [
            IconButton(
              icon: const Icon(Icons.download),
              tooltip: isMerge ? "Download (best quality)" : "Download",
              onPressed: () => _grab(stream),
            ),
            // Anything not already mp3 -- a video stream (extract its
            // audio track) or an audio stream in another container
            // like Anghami's m4a -- can go through ffmpeg's
            // extract-audio action; ffmpeg's -vn is a no-op when
            // there's no video track, so this is safe for
            // audio-only sources too. Same fix as the browser
            // extension's popup.js/content-script.js, which had the
            // identical `!isAudioOnly` gate backwards.
            if (stream.container != "mp3")
              IconButton(
                icon: const Icon(Icons.audiotrack),
                tooltip: stream.isAudioOnly ? "Convert to MP3" : "Extract audio (MP3)",
                onPressed: () => _grab(
                  stream,
                  postProcess: PostProcessSpec(
                    action: PostProcessAction.extractAudio,
                    targetContainer: TargetContainer.mp3,
                    tags: PostProcessTags(title: stream.title),
                  ),
                ),
              ),
            // Merge entries are already mp4 -- this is for a raw video
            // format that came in as webm/mkv/etc and the user wants
            // standardized to mp4.
            if (!isMerge && !stream.isAudioOnly && stream.container != "mp4")
              IconButton(
                icon: const Icon(Icons.movie_creation_outlined),
                tooltip: "Convert to MP4",
                onPressed: () => _grab(
                  stream,
                  postProcess: PostProcessSpec(
                    action: PostProcessAction.transcode,
                    targetContainer: TargetContainer.mp4,
                    tags: PostProcessTags(title: stream.title),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
