// Mirrors StreamDescriptor / SniffResult in docs/API.md.

enum StreamProtocol { hls, dash, direct, progressive }

StreamProtocol streamProtocolFromString(String value) {
  return StreamProtocol.values.firstWhere(
    (p) => p.name == value,
    orElse: () => StreamProtocol.direct,
  );
}

class StreamDescriptor {
  final String id;
  final String url;
  final StreamProtocol protocol;
  final String? container;
  final String? codec;
  final double? bitrateKbps;
  final String? resolution;
  final double? durationSeconds;
  final bool isAudioOnly;
  // Distinguishes a real playable audio+video mp4 from a silent
  // video-only DASH stream -- both are isAudioOnly=false without this.
  // See sniffer-service/app/models.py for the fuller rationale.
  final bool hasAudio;
  final String? title;
  final String? thumbnailUrl;
  final String extractor;

  const StreamDescriptor({
    required this.id,
    required this.url,
    required this.protocol,
    required this.container,
    required this.codec,
    required this.bitrateKbps,
    required this.resolution,
    required this.durationSeconds,
    required this.isAudioOnly,
    required this.hasAudio,
    required this.title,
    required this.thumbnailUrl,
    required this.extractor,
  });

  factory StreamDescriptor.fromJson(Map<String, dynamic> json) => StreamDescriptor(
        id: json["id"] as String,
        url: json["url"] as String,
        protocol: streamProtocolFromString(json["protocol"] as String),
        container: json["container"] as String?,
        codec: json["codec"] as String?,
        bitrateKbps: (json["bitrateKbps"] as num?)?.toDouble(),
        resolution: json["resolution"] as String?,
        durationSeconds: (json["durationSeconds"] as num?)?.toDouble(),
        isAudioOnly: json["isAudioOnly"] as bool? ?? false,
        hasAudio: json["hasAudio"] as bool? ?? true,
        title: json["title"] as String?,
        thumbnailUrl: json["thumbnailUrl"] as String?,
        extractor: json["extractor"] as String? ?? "yt-dlp",
      );
}

class SniffResult {
  final String pageUrl;
  final String? pageTitle;
  final List<StreamDescriptor> streams;
  final List<String> warnings;

  const SniffResult({
    required this.pageUrl,
    required this.pageTitle,
    required this.streams,
    required this.warnings,
  });

  factory SniffResult.fromJson(Map<String, dynamic> json) => SniffResult(
        pageUrl: json["pageUrl"] as String,
        pageTitle: json["pageTitle"] as String?,
        streams: (json["streams"] as List<dynamic>)
            .map((s) => StreamDescriptor.fromJson(s as Map<String, dynamic>))
            .toList(),
        warnings: (json["warnings"] as List<dynamic>? ?? []).cast<String>(),
      );
}
