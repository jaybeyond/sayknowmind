import '../core/api_client.dart';
import '../models/memory.dart';

class MemoryPage {
  MemoryPage(this.items, this.page, this.hasMore);
  final List<Memory> items;
  final int page;
  final bool hasMore;
}

class DocumentRepository {
  DocumentRepository(this._api);
  final ApiClient _api;

  static const int pageSize = 20;

  Future<MemoryPage> list({
    int page = 1,
    String? q,
    String? categoryId,
    String? sourceType,
    bool? isFavorite,
    String status = 'active',
  }) async {
    final data = await _api.get('/api/documents', query: {
      'page': page,
      'limit': pageSize,
      'q': q,
      'categoryId': categoryId,
      'sourceType': sourceType,
      if (isFavorite == true) 'isFavorite': 'true',
      'status': status,
    });
    final rows = (data['documents'] as List? ?? const [])
        .whereType<Map>()
        .map((r) => Memory.fromRow(r.cast<String, dynamic>()))
        .toList();
    final pg = (data['pagination'] as Map?)?.cast<String, dynamic>() ?? {};
    return MemoryPage(rows, page, pg['hasMore'] == true);
  }

  Future<Memory> get(String id) async {
    final row = await _api.get('/api/documents/$id');
    return Memory.fromRow((row as Map).cast<String, dynamic>());
  }

  Future<void> patchMetadata(String id, Map<String, dynamic> metadata) =>
      _api.patch('/api/documents/$id', body: {'metadata': metadata});

  Future<void> setFavorite(String id, bool favorite) =>
      patchMetadata(id, {'isFavorite': favorite});

  /// status: active | archived | trashed
  Future<void> setStatus(String id, String status) =>
      patchMetadata(id, {'status': status});

  Future<void> setCategory(String id, String? categoryId) =>
      _api.patch('/api/documents/$id', body: {'categoryId': categoryId});

  Future<void> hardDelete(String id) => _api.delete('/api/documents/$id');
}
