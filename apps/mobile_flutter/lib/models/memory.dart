/// A "memory" (document) as the feed/detail UI consumes it. Mirrors the web's
/// store/memory-store.ts `documentToMemory` mapping so the apps stay in lockstep:
/// tags are a deduped merge of user+ai+legacy tags, ogImage is always routed
/// through the /api/og or /api/files proxy (never a raw external CDN URL), and
/// favicon is derived from the source URL.
class Memory {
  Memory({
    required this.id,
    required this.title,
    required this.content,
    required this.url,
    required this.summary,
    required this.faviconUrl,
    required this.categoryIds,
    required this.categories,
    required this.tags,
    required this.aiTags,
    required this.userTags,
    required this.createdAt,
    required this.isFavorite,
    required this.privacyLevel,
    required this.docType,
    required this.fileType,
    required this.aiSummary,
    required this.whatItSolves,
    required this.keyPoints,
    required this.readingTimeMinutes,
    required this.ogImagePath,
    required this.status,
    required this.jobStatus,
  });

  final String id;
  final String title;
  final String content;
  final String url;
  final String summary;
  final String? faviconUrl;
  final List<String> categoryIds;
  final List<MemoryCategory> categories;
  final List<String> tags;
  final List<String> aiTags;
  final List<String> userTags;
  final DateTime createdAt;
  final bool isFavorite;
  final String privacyLevel; // private | shared
  final String docType; // url | file | text | doc | mindmap | sheet
  final String? fileType;
  final String? aiSummary;
  final String? whatItSolves;
  final List<String> keyPoints;
  final int? readingTimeMinutes;

  /// API-relative path (`/api/og/{id}` or `/api/files/{id}`) or null.
  final String? ogImagePath;
  final String status; // active | archived | trashed
  final String? jobStatus; // pending | processing | completed | failed | null

  bool get hasImage => ogImagePath != null;
  bool get isProcessing => jobStatus == 'pending' || jobStatus == 'processing';

  static List<String> _stringList(dynamic v) =>
      (v is List ? v : const []).whereType<String>().toList();

  factory Memory.fromRow(Map<String, dynamic> row) {
    final meta = (row['metadata'] as Map?)?.cast<String, dynamic>() ?? {};
    final id = '${row['id']}';
    final url = '${row['url'] ?? ''}';

    final sourceType = '${row['source_type'] ?? ''}';
    const known = {'file', 'text', 'doc', 'mindmap', 'sheet'};
    final docType = known.contains(sourceType) ? sourceType : 'url';
    final fileType = meta['fileType'] is String ? meta['fileType'] as String : null;
    final isImage = docType == 'file' && fileType == 'image';
    final hasFile = meta['filePath'] is String;

    final userTags = _stringList(meta['userTags']);
    final aiTags = _stringList(meta['aiTags']);
    final legacy = _stringList(meta['tags']);
    final tags = {...userTags, ...aiTags, ...legacy}.toList();

    final cats = (row['categories'] as List? ?? const [])
        .whereType<Map>()
        .map((c) => MemoryCategory.fromJson(c.cast<String, dynamic>()))
        .toList();

    // ogImage proxy logic, identical to memory-store.ts: never expose a raw
    // external CDN URL — always go through our /api/og or /api/files proxy.
    String? ogImagePath;
    final rawOg = meta['ogImage'];
    if (rawOg is String && rawOg.isNotEmpty) {
      ogImagePath = (rawOg.startsWith('/api/og/') || rawOg.startsWith('/api/files/'))
          ? rawOg
          : '/api/og/$id';
    } else if (isImage && hasFile) {
      ogImagePath = '/api/files/$id';
    }

    String? favicon;
    if (url.isNotEmpty) {
      final host = Uri.tryParse(url)?.host ?? '';
      if (host.isNotEmpty) {
        favicon = 'https://www.google.com/s2/favicons?domain=$host&sz=64';
      }
    }

    return Memory(
      id: id,
      title: '${row['title'] ?? ''}',
      content: '${row['content'] ?? ''}',
      url: url,
      summary: '${row['summary'] ?? ''}',
      faviconUrl: favicon,
      categories: cats,
      categoryIds: cats.map((c) => c.id).toList(),
      tags: tags,
      aiTags: aiTags,
      userTags: userTags,
      createdAt: DateTime.tryParse('${row['created_at'] ?? ''}') ?? DateTime.now(),
      isFavorite: meta['isFavorite'] == true,
      privacyLevel: row['privacy_level'] == 'shared' ? 'shared' : 'private',
      docType: docType,
      fileType: fileType,
      aiSummary: meta['summary'] is String ? meta['summary'] as String : null,
      whatItSolves:
          meta['what_it_solves'] is String ? meta['what_it_solves'] as String : null,
      keyPoints: _stringList(meta['key_points']),
      readingTimeMinutes:
          meta['reading_time_minutes'] is num ? (meta['reading_time_minutes'] as num).toInt() : null,
      ogImagePath: ogImagePath,
      status: meta['status'] is String ? meta['status'] as String : 'active',
      jobStatus: row['job_status'] is String ? row['job_status'] as String : null,
    );
  }
}

class MemoryCategory {
  MemoryCategory({required this.id, required this.name, this.color});
  final String id;
  final String name;
  final String? color;

  factory MemoryCategory.fromJson(Map<String, dynamic> j) => MemoryCategory(
        id: '${j['id']}',
        name: '${j['name'] ?? ''}',
        color: j['color'] as String?,
      );
}
