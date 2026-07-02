/// A category/collection. Categories double as collections — `kind` namespaces
/// them ('collection' | 'doc' | 'mindmap'). Snake_case from the API.
class Collection {
  Collection({
    required this.id,
    required this.name,
    required this.color,
    required this.kind,
    required this.parentId,
    required this.depth,
    required this.path,
  });

  final String id;
  final String name;
  final String? color;
  final String kind;
  final String? parentId;
  final int depth;
  final String path;

  bool get isCollection => kind == 'collection';

  factory Collection.fromJson(Map<String, dynamic> j) => Collection(
        id: '${j['id']}',
        name: '${j['name'] ?? ''}',
        color: j['color'] as String?,
        kind: '${j['kind'] ?? 'collection'}',
        parentId: j['parent_id'] as String?,
        depth: j['depth'] is num ? (j['depth'] as num).toInt() : 0,
        path: '${j['path'] ?? ''}',
      );
}
