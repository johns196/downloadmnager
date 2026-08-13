import "package:flutter/foundation.dart";

import "../models/settings.dart";
import "../services/api_client.dart";

class SettingsStore extends ChangeNotifier {
  final ApiClient api;
  GlobalSettings settings;
  bool loading = false;
  String? error;

  SettingsStore({required this.api})
      : settings = const GlobalSettings(maxConcurrentJobs: 3, maxChunksPerJob: 8, globalBandwidthCap: null);

  Future<void> load() async {
    loading = true;
    notifyListeners();
    try {
      settings = await api.getSettings();
      error = null;
    } catch (err) {
      error = err.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> update(GlobalSettings next) async {
    settings = await api.updateSettings(next);
    notifyListeners();
  }
}
