import '../core/api_client.dart';
import '../models/search_result.dart';

class SearchRepository {
  SearchRepository(this._api);
  final ApiClient _api;

  Future<List<SearchHit>> search(String query, {int limit = 20}) async {
    final data = await _api.post('/api/search', body: {
      'query': query.trim(),
      'mode': 'hybrid',
      'limit': limit,
      'offset': 0,
    });
    final results = (data['results'] as List? ?? const [])
        .whereType<Map>()
        .map((r) => SearchHit.fromJson(r.cast<String, dynamic>()))
        .toList();
    return results;
  }
}
