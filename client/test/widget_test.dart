import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

import "package:download_manager_client/main.dart";

void main() {
  testWidgets("App builds without throwing", (WidgetTester tester) async {
    await tester.pumpWidget(const DownloadManagerApp(backendHost: "127.0.0.1:8787"));
    // One frame is enough for a smoke test -- DownloadStore/SettingsStore
    // kick off real network calls to the backend on init(), which won't
    // resolve in a test environment; pumpAndSettle would hang waiting on
    // those instead of just confirming the widget tree builds.
    await tester.pump();
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
