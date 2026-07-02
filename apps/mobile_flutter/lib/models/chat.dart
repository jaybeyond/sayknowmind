/// A conversation row (GET /api/conversations).
class Conversation {
  Conversation({
    required this.id,
    required this.title,
    required this.updatedAt,
  });

  final String id;
  final String title;
  final DateTime updatedAt;

  factory Conversation.fromJson(Map<String, dynamic> j) => Conversation(
        id: '${j['id']}',
        title: '${j['title'] ?? 'New Conversation'}',
        updatedAt: DateTime.tryParse('${j['updated_at'] ?? ''}') ?? DateTime.now(),
      );
}

/// A citation/source attached to an assistant answer.
class Citation {
  Citation({required this.title, this.url, this.excerpt = '', this.documentId});
  final String? documentId;
  final String title;
  final String? url;
  final String excerpt;

  factory Citation.fromJson(Map<String, dynamic> j) => Citation(
        documentId: (j['documentId'] ?? j['id'])?.toString(),
        title: '${j['title'] ?? ''}',
        url: j['url'] as String?,
        excerpt: '${j['excerpt'] ?? ''}',
      );
}

/// A persisted message (GET /api/conversations/[id]/messages) or a live one.
class ChatMessage {
  ChatMessage({
    required this.role,
    required this.content,
    this.citations = const [],
    this.streaming = false,
  });

  final String role; // user | assistant | system
  String content;
  List<Citation> citations;
  bool streaming;

  bool get isUser => role == 'user';

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        role: '${j['role'] ?? 'assistant'}',
        content: '${j['content'] ?? ''}',
        citations: (j['citations'] as List? ?? const [])
            .whereType<Map>()
            .map((c) => Citation.fromJson(c.cast<String, dynamic>()))
            .toList(),
      );
}

/// One decoded `data:` frame from POST /api/chat. The kind is carried INSIDE
/// the JSON as `type` (status | log | sources | answer | done | error).
class ChatStreamEvent {
  ChatStreamEvent(this.type, this.raw);
  final String type;
  final Map<String, dynamic> raw;

  // `answer` frames carry the streamed token in `token`; status/log/error use
  // `message`; some legacy/server paths use `content`. Check all three.
  String? get text =>
      raw['token']?.toString() ?? raw['content']?.toString() ?? raw['message']?.toString();
  String? get conversationId => raw['conversationId']?.toString();

  List<Citation> get sources => (raw['sources'] as List? ?? const [])
      .whereType<Map>()
      .map((s) => Citation.fromJson(s.cast<String, dynamic>()))
      .toList();

  factory ChatStreamEvent.fromJson(Map<String, dynamic> j) =>
      ChatStreamEvent('${j['type'] ?? 'log'}', j);
}
