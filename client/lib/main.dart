import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "screens/home_screen.dart";
import "services/api_client.dart";
import "services/connection_prefs.dart";
import "services/websocket_service.dart";
import "state/download_store.dart";
import "state/settings_store.dart";
import "theme/app_theme.dart";

// The default ("127.0.0.1:8787") matches the port frozen in docs/API.md --
// change there first if you change it here. The *actual* host used at
// runtime is a persisted user setting (see ConnectionPrefs /
// SettingsScreen), loaded once here before the provider tree is built so
// ApiClient/WebSocketService never need to be reconstructed mid-session --
// changing the setting takes effect on next app launch, not live, to
// avoid tearing down and rebuilding every provider that depends on them.
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final host = await ConnectionPrefs.getHost();
  runApp(DownloadManagerApp(backendHost: host));
}

class DownloadManagerApp extends StatelessWidget {
  final String backendHost;
  const DownloadManagerApp({super.key, required this.backendHost});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>(create: (_) => ApiClient(baseUrl: ConnectionPrefs.httpBaseFor(backendHost))),
        Provider<WebSocketService>(
          create: (_) => WebSocketService(wsUrl: ConnectionPrefs.wsUrlFor(backendHost)),
          dispose: (_, ws) => ws.dispose(),
        ),
        // update() only ever creates+initializes a fresh store the first
        // time (when `previous` is null); an existing store is returned
        // as-is so we don't reconnect the WebSocket or re-fetch settings
        // on every ancestor rebuild. Written as an explicit block rather
        // than `previous ?? Store()..init()` -- cascade binds looser than
        // `??`, so that shorthand would silently re-run init() on the
        // *result* of the whole expression, including an existing
        // `previous`, every single time update() fires.
        ChangeNotifierProxyProvider2<ApiClient, WebSocketService, DownloadStore>(
          create: (context) => DownloadStore(
            api: context.read<ApiClient>(),
            ws: context.read<WebSocketService>(),
          )..initialize(),
          update: (context, api, ws, previous) {
            if (previous != null) return previous;
            final store = DownloadStore(api: api, ws: ws);
            store.initialize();
            return store;
          },
        ),
        ChangeNotifierProxyProvider<ApiClient, SettingsStore>(
          create: (context) => SettingsStore(api: context.read<ApiClient>())..load(),
          update: (context, api, previous) {
            if (previous != null) return previous;
            final store = SettingsStore(api: api);
            store.load();
            return store;
          },
        ),
      ],
      child: MaterialApp(
        title: "Download Manager",
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        themeMode: ThemeMode.system,
        home: const HomeScreen(),
      ),
    );
  }
}
