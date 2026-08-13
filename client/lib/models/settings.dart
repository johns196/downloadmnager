// Mirrors GlobalSettings / ScheduleRule in docs/API.md.

class GlobalSettings {
  final int maxConcurrentJobs;
  final int maxChunksPerJob;
  final int? globalBandwidthCap; // bytes/sec, null = unlimited

  const GlobalSettings({
    required this.maxConcurrentJobs,
    required this.maxChunksPerJob,
    required this.globalBandwidthCap,
  });

  factory GlobalSettings.fromJson(Map<String, dynamic> json) => GlobalSettings(
        maxConcurrentJobs: json["maxConcurrentJobs"] as int,
        maxChunksPerJob: json["maxChunksPerJob"] as int,
        globalBandwidthCap: json["globalBandwidthCap"] as int?,
      );

  Map<String, dynamic> toJson() => {
        "maxConcurrentJobs": maxConcurrentJobs,
        "maxChunksPerJob": maxChunksPerJob,
        "globalBandwidthCap": globalBandwidthCap,
      };

  GlobalSettings copyWith({int? maxConcurrentJobs, int? maxChunksPerJob, int? globalBandwidthCap}) => GlobalSettings(
        maxConcurrentJobs: maxConcurrentJobs ?? this.maxConcurrentJobs,
        maxChunksPerJob: maxChunksPerJob ?? this.maxChunksPerJob,
        globalBandwidthCap: globalBandwidthCap ?? this.globalBandwidthCap,
      );
}

class ScheduleRule {
  final String id;
  final String label;
  final bool enabled;
  final int startHour;
  final int endHour;
  final List<int> daysOfWeek;
  final int? bandwidthCapBytesPerSec;

  const ScheduleRule({
    required this.id,
    required this.label,
    required this.enabled,
    required this.startHour,
    required this.endHour,
    required this.daysOfWeek,
    required this.bandwidthCapBytesPerSec,
  });

  factory ScheduleRule.fromJson(Map<String, dynamic> json) => ScheduleRule(
        id: json["id"] as String,
        label: json["label"] as String,
        enabled: json["enabled"] as bool,
        startHour: json["startHour"] as int,
        endHour: json["endHour"] as int,
        daysOfWeek: (json["daysOfWeek"] as List<dynamic>).cast<int>(),
        bandwidthCapBytesPerSec: json["bandwidthCapBytesPerSec"] as int?,
      );

  Map<String, dynamic> toJson() => {
        "id": id,
        "label": label,
        "enabled": enabled,
        "startHour": startHour,
        "endHour": endHour,
        "daysOfWeek": daysOfWeek,
        "bandwidthCapBytesPerSec": bandwidthCapBytesPerSec,
      };
}
