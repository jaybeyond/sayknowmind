import '../core/api_client.dart';
import '../models/category.dart';

class CategoryRepository {
  CategoryRepository(this._api);
  final ApiClient _api;

  Future<List<Collection>> list() async {
    final data = await _api.get('/api/categories');
    return (data['categories'] as List? ?? const [])
        .whereType<Map>()
        .map((c) => Collection.fromJson(c.cast<String, dynamic>()))
        .toList();
  }

  /// Only the user-facing collections (kind == 'collection').
  Future<List<Collection>> collections() async =>
      (await list()).where((c) => c.isCollection).toList();

  Future<String> create(String name, {String? color}) async {
    final data = await _api.post('/api/categories', body: {
      'name': name.trim(),
      'kind': 'collection',
      if (color != null) 'color': color,
    });
    return '${(data as Map)['categoryId'] ?? ''}';
  }
}
