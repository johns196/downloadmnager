import "package:flutter/foundation.dart";

import "../models/download_job.dart";
import "../models/ws_event.dart";
import "../services/api_client.dart";
import "../services/websocket_service.dart";

/// Single source of truth for the job list, kept live via WebSocket events
/// pushed from the backend (see docs/API.md) rather than polling. An
/// initial REST fetch seeds the list; after that, job:added/update/removed
/// events mutate it in place.
class DownloadStore extends ChangeNotifier {
  final ApiClient api;
  final WebSocketService ws;

  final Map<String, DownloadJob> _jobsById = {};
  final Map<String, List<double>> _speedHistoryById = {};
  bool backendOnline = false;
  String? lastError;

  static const int maxSpeedSamples = 60;

  DownloadStore({required this.api, required this.ws}) {
    ws.events.listen(_onWsEvent);
  }

  List<DownloadJob> get jobs => _jobsById.values.toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt));

  List<DownloadJob> get active => jobs.where((j) => j.state == JobState.active).toList();
  List<DownloadJob> get queuedOrPaused =>
      jobs.where((j) => j.state == JobState.queued || j.state == JobState.paused).toList();
  List<DownloadJob> get completed => jobs.where((j) => j.state == JobState.completed).toList();
  List<DownloadJob> get failed => jobs.where((j) => j.state == JobState.error).toList();

  List<double> speedHistoryFor(String jobId) => _speedHistoryById[jobId] ?? const [];

  Future<void> initialize() async {
    ws.connect();
    await refresh();
  }

  Future<void> refresh() async {
    try {
      final list = await api.listJobs();
      _jobsById
        ..clear()
        ..addEntries(list.map((j) => MapEntry(j.id, j)));
      backendOnline = true;
      lastError = null;
    } catch (err) {
      backendOnline = false;
      lastError = err.toString();
    }
    notifyListeners();
  }

  void _onWsEvent(WsEvent event) {
    switch (event.type) {
      case WsEventType.jobAdded:
      case WsEventType.jobUpdate:
        if (event.job != null) {
          _jobsById[event.jobId] = event.job!;
          _recordSpeedSample(event.jobId, event.job!.speedBytesPerSec);
        }
        break;
      case WsEventType.jobRemoved:
        _jobsById.remove(event.jobId);
        _speedHistoryById.remove(event.jobId);
        break;
      case WsEventType.jobLog:
        // Surfaced via UI snackbars by the screen that's listening, not
        // stored here -- log lines aren't part of job state.
        break;
    }
    backendOnline = true;
    notifyListeners();
  }

  void _recordSpeedSample(String jobId, double speed) {
    final history = _speedHistoryById.putIfAbsent(jobId, () => []);
    history.add(speed);
    if (history.length > maxSpeedSamples) history.removeAt(0);
  }

  Future<void> addLink(String url, {String? filename, int? chunks}) async {
    final job = await api.createJob(url: url, filename: filename, chunks: chunks);
    _jobsById[job.id] = job;
    notifyListeners();
  }

  Future<void> pause(String id) async {
    final job = await api.pauseJob(id);
    _jobsById[id] = job;
    notifyListeners();
  }

  Future<void> resume(String id) async {
    final job = await api.resumeJob(id);
    _jobsById[id] = job;
    notifyListeners();
  }

  Future<void> remove(String id, {bool deleteFile = false}) async {
    await api.removeJob(id, deleteFile: deleteFile);
    _jobsById.remove(id);
    _speedHistoryById.remove(id);
    notifyListeners();
  }

  Future<void> setThrottle(String id, int? bytesPerSec) async {
    final job = await api.setThrottle(id, bytesPerSec);
    _jobsById[id] = job;
    notifyListeners();
  }

  @override
  void dispose() {
    ws.dispose();
    super.dispose();
  }
}
