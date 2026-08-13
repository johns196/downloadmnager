import "package:shared_preferences/shared_preferences.dart";

/// Persists the backend's address across app restarts. Kept separate from
/// SettingsStore (which mirrors the backend's own GlobalSettings) since
/// this is a *local device* preference -- it has to be known before the
/// app can talk to a backend at all, not fetched from one.
///
/// Defaults to the localhost dev backend so the app works out of the box
/// during development; meant to be pointed at a deployed backend's
/// address later via SettingsScreen without a rebuild.
class ConnectionPrefs {
  static const _hostKey = "backend_host"; // e.g. "127.0.0.1:8787" or "example.com"
  static const defaultHost = "127.0.0.1:8787";

  static Future<String> getHost() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_hostKey) ?? defaultHost;
  }

  static Future<void> setHost(String host) async {
    final prefs = await SharedPreferences.getInstance();
    final trimmed = host.trim();
    if (trimmed.isEmpty || trimmed == defaultHost) {
      await prefs.remove(_hostKey);
    } else {
      await prefs.setString(_hostKey, trimmed);
    }
  }

  static String httpBaseFor(String host) => "http://$host/api";
  static String wsUrlFor(String host) => "ws://$host/ws";
}
