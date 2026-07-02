import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../models/category.dart';
import '../../providers.dart';
import '../../widgets/states.dart';
import 'collection_screen.dart';

class CollectionsTab extends ConsumerWidget {
  const CollectionsTab({super.key});

  Color _color(Collection c, ColorScheme scheme) {
    final hex = c.color;
    if (hex != null && hex.startsWith('#') && hex.length >= 7) {
      final v = int.tryParse(hex.substring(1, 7), radix: 16);
      if (v != null) return Color(0xFF000000 | v);
    }
    return AppColors.brandCyan;
  }

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New collection'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Collection name'),
          onSubmitted: (v) => Navigator.pop(context, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, controller.text),
              child: const Text('Create')),
        ],
      ),
    );
    if (name != null && name.trim().isNotEmpty) {
      await ref.read(categoryRepositoryProvider).create(name.trim());
      ref.invalidate(collectionsProvider);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final collections = ref.watch(collectionsProvider);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Collections'),
        actions: [
          IconButton(
            icon: const Icon(Icons.create_new_folder_outlined),
            onPressed: () => _create(context, ref),
          ),
        ],
      ),
      body: collections.when(
        loading: () => const LoadingList(),
        error: (e, _) => ErrorRetry(
          message: '$e',
          onRetry: () => ref.invalidate(collectionsProvider),
        ),
        data: (items) {
          if (items.isEmpty) {
            return EmptyState(
              icon: Icons.folder_open,
              title: 'No collections yet',
              message: 'Group related memories into collections.',
              action: FilledButton.icon(
                onPressed: () => _create(context, ref),
                icon: const Icon(Icons.add),
                label: const Text('New collection'),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(collectionsProvider),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final c = items[i];
                return Card(
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: _color(c, scheme).withValues(alpha: 0.18),
                      child: Icon(Icons.folder, color: _color(c, scheme)),
                    ),
                    title: Text(c.name),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CollectionScreen(id: c.id, name: c.name),
                      ),
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
