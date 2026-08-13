import "dart:convert";
import "package:http/http.dart" as http;

import "../models/download_job.dart";
import "../models/settings.dart";
import "../models/stream_descriptor.dart";

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  ApiException(this.message, [this.statusCode]);

  @override
  String toString() => "ApiException($statusCode): $message";
}

/// Thin REST wrapper around the backend defined in docs/API.md. Base URL
/// is user-configurable (see SettingsScreen) since the backend, extension
/// and client all run on the same machine but the port could be changed
/// in backend/.env -- default matches the port frozen in API.md.
class ApiClient {
  String baseUrl;

  ApiClient({this.baseUrl = "http://127.0.0.1:8787/api"});

  Uri _uri(String path, [Map<String, String>? query]) => Uri.parse("$baseUrl$path").replace(queryParameters: query);

  Future<dynamic> _get(String path) => _handle(http.get(_uri(path)));
  Future<dynamic> _post(String path, [Map<String, dynamic>? body]) =>
      _handle(http.post(_uri(path), headers: _jsonHeaders, body: body != null ? jsonEncode(body) : null));
  Future<dynamic> _put(String path, dynamic body) =>
      _handle(http.put(_uri(path), headers: _jsonHeaders, body: jsonEncode(body)));
  Future<void> _delete(String path, [Map<String, String>? query]) async {
    final res = await http.delete(_uri(path, query));
    if (res.statusCode >= 400) {
      throw ApiException(res.body, res.statusCode);
    }
  }

  static const _jsonHeaders = {"Content-Type": "application/json"};

  Future<dynamic> _handle(Future<http.Response> request) async {
    final res = await request;
    if (res.statusCode >= 400) {
      String message = res.body;
      try {
        final parsed = jsonDecode(res.body);
        if (parsed is Map && parsed["error"] != null) message = parsed["error"].toString();
      } catch (_) {
        // body wasn't JSON -- use raw text
      }
      throw ApiException(message, res.statusCode);
    }
    if (res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }

  Future<bool> health() async {
    try {
      final result = await _get("/health");
      return result is Map && result["ok"] == true;
    } catch (_) {
      return false;
    }
  }

  Future<List<DownloadJob>> listJobs() async {
    final result = await _get("/jobs") as List<dynamic>;
    return result.map((j) => DownloadJob.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<DownloadJob> createJob({required String url, String? filename, int? chunks, MediaKind? mediaKind}) async {
    final result = await _post("/jobs", {
      "url": url,
      if (filename != null) "filename": filename,
      if (chunks != null) "chunks": chunks,
      if (mediaKind != null) "mediaKind": mediaKind.name,
    });
    return DownloadJob.fromJson(result as Map<String, dynamic>);
  }

  Future<DownloadJob> pauseJob(String id) async {
    final result = await _post("/jobs/$id/pause");
    return DownloadJob.fromJson(result as Map<String, dynamic>);
  }

  Future<DownloadJob> resumeJob(String id) async {
    final result = await _post("/jobs/$id/resume");
    return DownloadJob.fromJson(result as Map<String, dynamic>);
  }

  Future<DownloadJob> setThrottle(String id, int? bytesPerSec) async {
    final result = await _post("/jobs/$id/throttle", {"bytesPerSec": bytesPerSec});
    return DownloadJob.fromJson(result as Map<String, dynamic>);
  }

  Future<void> removeJob(String id, {bool deleteFile = false}) =>
      _delete("/jobs/$id", {"deleteFile": deleteFile.toString()});

  Future<GlobalSettings> getSettings() async {
    final result = await _get("/settings");
    return GlobalSettings.fromJson(result as Map<String, dynamic>);
  }

  Future<GlobalSettings> updateSettings(GlobalSettings settings) async {
    final result = await _put("/settings", settings.toJson());
    return GlobalSettings.fromJson(result as Map<String, dynamic>);
  }

  Future<SniffResult> sniff(String url) async {
    final result = await _post("/sniff", {"url": url});
    return SniffResult.fromJson(result as Map<String, dynamic>);
  }

  Future<DownloadJob> grabStream(String pageUrl, String streamId, {PostProcessSpec? postProcess}) async {
    final result = await _post("/sniff/grab", {
      "url": pageUrl,
      "streamId": streamId,
      if (postProcess != null) "postProcess": postProcess.toJson(),
    });
    return DownloadJob.fromJson(result as Map<String, dynamic>);
  }

  String downloadUrlFor(DownloadJob job) {
    final origin = Uri.parse(baseUrl).replace(path: "").toString();
    return "$origin/downloads/${Uri.encodeComponent(job.filename)}";
  }
}
