import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../models/memory.dart';
import '../../providers.dart';
import '../../widgets/memory_card.dart';
import '../../widgets/states.dart';

/// Memories inside a single collection (filtered document list).
class CollectionScreen extends ConsumerStatefulWidget {
  const CollectionScreen({super.key, required this.id, required this.name});
  final String id;
  final String name;

  @override
  ConsumerState<CollectionScreen> createState() => _CollectionScreenState();
}

class _CollectionScreenState extends ConsumerState<CollectionScreen> {
  List<Memory>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final page = await ref
          .read(documentRepositoryProvider)
          .list(categoryId: widget.id, page: 1);
      if (mounted) setState(() => _items = page.items);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: Builder(builder: (context) {
        if (_error != null) return ErrorRetry(message: _error!, onRetry: _load);
        if (_items == null) return const LoadingList();
        if (_items!.isEmpty) {
          return const EmptyState(
            icon: Icons.folder_open,
            title: 'Empty collection',
            message: 'Nothing saved here yet.',
          );
        }
        return RefreshIndicator(
          onRefresh: _load,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            itemCount: _items!.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, i) {
              final m = _items![i];
              return MemoryCard(
                memory: m,
                onTap: () => context.push('/memory/${m.id}'),
              );
            },
          ),
        );
      }),
    );
  }
}
