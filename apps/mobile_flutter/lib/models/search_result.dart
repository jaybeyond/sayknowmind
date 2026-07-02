import 'chat.dart';

/// A single search hit (POST /api/search).
class SearchHit {
  SearchHit({
    required this.documentId,
    required this.title,
    required this.snippet,
    required this.score,
    required this.citations,
  });

  final String documentId;
  final String title;
  final String snippet;
  final double score;
  final List<Citation> citations;

  factory SearchHit.fromJson(Map<String, dynamic> j) => SearchHit(
        documentId: '${j['documentId'] ?? ''}',
        title: '${j['title'] ?? ''}',
        snippet: '${j['snippet'] ?? ''}',
        score: (j['score'] is num) ? (j['score'] as num).toDouble() : 0,
        citations: (j['citations'] as List? ?? const [])
            .whereType<Map>()
            .map((c) => Citation.fromJson(c.cast<String, dynamic>()))
            .toList(),
      );
}
