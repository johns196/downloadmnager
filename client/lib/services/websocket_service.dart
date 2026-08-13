import "dart:async";
import "dart:convert";

import "package:web_socket_channel/web_socket_channel.dart";

import "../models/ws_event.dart";

/// Connects to ws://<host>/ws (see docs/API.md) and re-broadcasts parsed
/// WsEvents on a Dart Stream. Auto-reconnects with a fixed backoff -- this
/// is a long-lived desktop/mobile app, the backend may restart while it's
/// open, and DownloadStore needs a live feed to reflect job progress
/// without polling.
class WebSocketService {
  final String wsUrl;
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  final _controller = StreamController<WsEvent>.broadcast();
  Timer? _reconnectTimer;
  bool _closedByUser = false;

  WebSocketService({required this.wsUrl});

  Stream<WsEvent> get events => _controller.stream;

  void connect() {
    _closedByUser = false;
    _connectInternal();
  }

  void _connectInternal() {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _subscription = _channel!.stream.listen(
        (data) {
          try {
            final json = jsonDecode(data as String) as Map<String, dynamic>;
            final event = WsEvent.tryParse(json);
            if (event != null) _controller.add(event);
          } catch (_) {
            // malformed frame -- ignore rather than crash the stream
          }
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_closedByUser) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 3), _connectInternal);
  }

  void dispose() {
    _closedByUser = true;
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _controller.close();
  }
}
