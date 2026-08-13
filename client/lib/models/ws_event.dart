import "download_job.dart";

// Mirrors WsEvent in docs/API.md. payload is either a full DownloadJob
// (job:update / job:added / job:removed) or {message} (job:log).
enum WsEventType { jobUpdate, jobAdded, jobRemoved, jobLog }

WsEventType? wsEventTypeFromString(String value) {
  switch (value) {
    case "job:update":
      return WsEventType.jobUpdate;
    case "job:added":
      return WsEventType.jobAdded;
    case "job:removed":
      return WsEventType.jobRemoved;
    case "job:log":
      return WsEventType.jobLog;
    default:
      return null;
  }
}

class WsEvent {
  final WsEventType type;
  final String jobId;
  final DownloadJob? job; // populated for job:update / job:added / job:removed
  final String? logMessage; // populated for job:log

  const WsEvent({required this.type, required this.jobId, this.job, this.logMessage});

  static WsEvent? tryParse(Map<String, dynamic> json) {
    final type = wsEventTypeFromString(json["type"] as String? ?? "");
    if (type == null) return null;
    final jobId = json["jobId"] as String? ?? "";
    final payload = json["payload"] as Map<String, dynamic>?;
    if (payload == null) return null;

    if (type == WsEventType.jobLog) {
      return WsEvent(type: type, jobId: jobId, logMessage: payload["message"] as String?);
    }
    return WsEvent(type: type, jobId: jobId, job: DownloadJob.fromJson(payload));
  }
}
