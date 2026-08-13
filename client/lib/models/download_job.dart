// Mirrors the DownloadJob shape frozen in docs/API.md at the repo root.
// Keep field names and the JobState enum identical to
// backend/src/core/types.ts and sniffer-service/app/models.py.

enum JobState { queued, active, paused, completed, error, canceled }

JobState jobStateFromString(String value) {
  return JobState.values.firstWhere(
    (s) => s.name == value,
    orElse: () => JobState.error,
  );
}

enum MediaKind { file, audio, video }

MediaKind mediaKindFromString(String value) {
  return MediaKind.values.firstWhere(
    (m) => m.name == value,
    orElse: () => MediaKind.file,
  );
}

enum JobSource { manual, extension, sniffer }

JobSource jobSourceFromString(String value) {
  return JobSource.values.firstWhere(
    (s) => s.name == value,
    orElse: () => JobSource.manual,
  );
}

enum PostProcessAction { remux, transcode, extractAudio }

String postProcessActionToWire(PostProcessAction action) {
  switch (action) {
    case PostProcessAction.remux:
      return "remux";
    case PostProcessAction.transcode:
      return "transcode";
    case PostProcessAction.extractAudio:
      return "extract-audio";
  }
}

enum TargetContainer { mp3, flac, mp4, mkv, m4a }

class PostProcessTags {
  final String? title;
  final String? artist;
  final String? album;
  final String? artworkUrl;

  const PostProcessTags({this.title, this.artist, this.album, this.artworkUrl});

  factory PostProcessTags.fromJson(Map<String, dynamic> json) => PostProcessTags(
        title: json["title"] as String?,
        artist: json["artist"] as String?,
        album: json["album"] as String?,
        artworkUrl: json["artworkUrl"] as String?,
      );

  Map<String, dynamic> toJson() => {
        if (title != null) "title": title,
        if (artist != null) "artist": artist,
        if (album != null) "album": album,
        if (artworkUrl != null) "artworkUrl": artworkUrl,
      };
}

class PostProcessSpec {
  final PostProcessAction action;
  final TargetContainer? targetContainer;
  final PostProcessTags? tags;

  const PostProcessSpec({required this.action, this.targetContainer, this.tags});

  factory PostProcessSpec.fromJson(Map<String, dynamic> json) => PostProcessSpec(
        action: _actionFromWire(json["action"] as String),
        targetContainer: json["targetContainer"] != null
            ? TargetContainer.values.firstWhere((c) => c.name == json["targetContainer"])
            : null,
        tags: json["tags"] != null ? PostProcessTags.fromJson(json["tags"] as Map<String, dynamic>) : null,
      );

  static PostProcessAction _actionFromWire(String value) {
    switch (value) {
      case "remux":
        return PostProcessAction.remux;
      case "transcode":
        return PostProcessAction.transcode;
      case "extract-audio":
        return PostProcessAction.extractAudio;
      default:
        return PostProcessAction.remux;
    }
  }

  Map<String, dynamic> toJson() => {
        "action": postProcessActionToWire(action),
        "targetContainer": targetContainer?.name,
        "tags": tags?.toJson(),
      };
}

class DownloadJob {
  final String id;
  final String url;
  final String filename;
  final String outputPath;
  final JobState state;
  final int? sizeBytes;
  final int downloadedBytes;
  final double speedBytesPerSec;
  final int? etaSeconds;
  final int chunks;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  final String? error;
  final String? sha256;
  final JobSource source;
  final MediaKind mediaKind;
  final PostProcessSpec? postProcess;

  const DownloadJob({
    required this.id,
    required this.url,
    required this.filename,
    required this.outputPath,
    required this.state,
    required this.sizeBytes,
    required this.downloadedBytes,
    required this.speedBytesPerSec,
    required this.etaSeconds,
    required this.chunks,
    required this.createdAt,
    required this.updatedAt,
    required this.completedAt,
    required this.error,
    required this.sha256,
    required this.source,
    required this.mediaKind,
    required this.postProcess,
  });

  double get progress => sizeBytes != null && sizeBytes! > 0 ? downloadedBytes / sizeBytes! : 0;

  factory DownloadJob.fromJson(Map<String, dynamic> json) => DownloadJob(
        id: json["id"] as String,
        url: json["url"] as String,
        filename: json["filename"] as String,
        outputPath: json["outputPath"] as String,
        state: jobStateFromString(json["state"] as String),
        sizeBytes: json["sizeBytes"] as int?,
        downloadedBytes: json["downloadedBytes"] as int? ?? 0,
        speedBytesPerSec: (json["speedBytesPerSec"] as num?)?.toDouble() ?? 0,
        etaSeconds: json["etaSeconds"] as int?,
        chunks: json["chunks"] as int? ?? 1,
        createdAt: DateTime.parse(json["createdAt"] as String),
        updatedAt: DateTime.parse(json["updatedAt"] as String),
        completedAt: json["completedAt"] != null ? DateTime.parse(json["completedAt"] as String) : null,
        error: json["error"] as String?,
        sha256: json["sha256"] as String?,
        source: jobSourceFromString(json["source"] as String),
        mediaKind: mediaKindFromString(json["mediaKind"] as String),
        postProcess:
            json["postProcess"] != null ? PostProcessSpec.fromJson(json["postProcess"] as Map<String, dynamic>) : null,
      );
}
