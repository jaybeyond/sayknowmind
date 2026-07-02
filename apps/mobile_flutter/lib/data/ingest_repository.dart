import '../core/api_client.dart';

class IngestResult {
  IngestResult({
    required this.documentId,
    required this.jobId,
    required this.title,
    this.duplicate = false,
    this.existingId,
  });
  final String documentId;
  final String jobId;
  final String title;
  final bool duplicate;
  final String? existingId;
}

class IngestRepository {
  IngestRepository(this._api);
  final ApiClient _api;

  Future<IngestResult> ingestUrl(
    String url, {
    String? categoryId,
    List<String>? tags,
    String? locale,
    bool force = false,
  }) async {
    try {
      final data = await _api.post('/api/ingest/url', body: {
        'url': url.trim(),
        if (categoryId != null) 'categoryId': categoryId,
        if (tags != null && tags.isNotEmpty) 'tags': tags,
        if (locale != null) 'locale': locale,
        if (force) 'force': true,
      });
      return _parse(data);
    } on ApiException catch (e) {
      // 409 = already saved; body carries existingId (not the error envelope).
      if (e.statusCode == 409 && e.data is Map) return _parse(e.data);
      rethrow;
    }
  }

  Future<IngestResult> ingestText(
    String content, {
    String? title,
    String? categoryId,
    List<String>? tags,
    String? locale,
  }) async {
    final data = await _api.post('/api/ingest/text', body: {
      'content': content,
      if (title != null && title.isNotEmpty) 'title': title,
      if (categoryId != null) 'categoryId': categoryId,
      if (tags != null && tags.isNotEmpty) 'tags': tags,
      if (locale != null) 'locale': locale,
    });
    return _parse(data);
  }

  IngestResult _parse(dynamic data) {
    final m = (data as Map).cast<String, dynamic>();
    if (m['duplicate'] == true) {
      return IngestResult(
        documentId: '${m['existingId'] ?? ''}',
        jobId: '',
        title: '${m['existingTitle'] ?? ''}',
        duplicate: true,
        existingId: m['existingId']?.toString(),
      );
    }
    return IngestResult(
      documentId: '${m['documentId'] ?? ''}',
      jobId: '${m['jobId'] ?? ''}',
      title: '${m['title'] ?? ''}',
    );
  }

  Future<({String status, int progress, String? error})> jobStatus(
      String jobId) async {
    final m =
        (await _api.get('/api/ingest/status/$jobId') as Map).cast<String, dynamic>();
    return (
      status: '${m['status'] ?? 'pending'}',
      progress: m['progress'] is num ? (m['progress'] as num).toInt() : 0,
      error: m['error'] as String?,
    );
  }
}
