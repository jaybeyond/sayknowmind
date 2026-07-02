import 'dart:convert';

import '../core/api_client.dart';
import '../models/chat.dart';

class ChatRepository {
  ChatRepository(this._api);
  final ApiClient _api;

  Future<List<Conversation>> conversations() async {
    final data = await _api.get('/api/conversations');
    return (data['conversations'] as List? ?? const [])
        .whereType<Map>()
        .map((c) => Conversation.fromJson(c.cast<String, dynamic>()))
        .toList();
  }

  Future<List<ChatMessage>> messages(String conversationId) async {
    final data = await _api.get('/api/conversations/$conversationId/messages');
    return (data['messages'] as List? ?? const [])
        .whereType<Map>()
        .map((m) => ChatMessage.fromJson(m.cast<String, dynamic>()))
        .toList();
  }

  Future<void> deleteConversation(String id) =>
      _api.delete('/api/conversations/$id');

  /// Streams the AI answer. Frames are `data: <json>\n\n`; the event kind is the
  /// JSON `type` field (status | log | sources | answer | done | error). Answer
  /// tokens are incremental and must be concatenated by the caller.
  Stream<ChatStreamEvent> streamChat(String message, {String? conversationId}) async* {
    final res = await _api.openStream('/api/chat', body: {
      'message': message,
      if (conversationId != null) 'conversationId': conversationId,
    });

    final status = res.statusCode ?? 0;
    final Stream<List<int>> byteStream = res.data!.stream;

    // Pre-stream failure: non-200 carries a JSON error body (e.g. 429 daily
    // limit, 401), not an SSE frame. Collect and surface it.
    if (status != 200) {
      final bytes = <int>[];
      await for (final c in byteStream) {
        bytes.addAll(c);
      }
      String message = 'Chat failed ($status)';
      Object? code;
      try {
        final j = jsonDecode(utf8.decode(bytes));
        if (j is Map) {
          message = (j['message'] ?? j['error'] ?? message).toString();
          code = j['code'];
          if (code == 'DAILY_LIMIT_EXCEEDED') {
            message =
                'Daily free message limit reached (${j['used']}/${j['limit']}). Add your own API key to continue.';
          }
        }
      } catch (_) {/* keep default */}
      if (status == 401) _api.onUnauthorized?.call();
      throw ApiException(message, statusCode: status, code: code);
    }

    final lines = const LineSplitter().bind(utf8.decoder.bind(byteStream));
    await for (final line in lines) {
      if (!line.startsWith('data: ')) continue;
      final payload = line.substring(6);
      if (payload.isEmpty) continue;
      try {
        final j = jsonDecode(payload);
        if (j is Map) {
          yield ChatStreamEvent.fromJson(j.cast<String, dynamic>());
        }
      } catch (_) {
        // ignore malformed/partial frame
      }
    }
  }
}
