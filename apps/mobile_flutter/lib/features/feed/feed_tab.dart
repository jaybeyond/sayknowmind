import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/memory.dart';
import '../../providers.dart';
import '../../widgets/brand.dart';
import '../../widgets/memory_card.dart';
import '../../widgets/states.dart';

class FeedTab extends ConsumerStatefulWidget {
  const FeedTab({super.key});

  @override
  ConsumerState<FeedTab> createState() => _FeedTabState();
}

class _FeedTabState extends ConsumerState<FeedTab> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback(
        (_) => ref.read(feedControllerProvider.notifier).refresh());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 400) {
      ref.read(feedControllerProvider.notifier).loadMore();
    }
  }

  Future<void> _showMore(Memory m) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.archive_outlined),
              title: const Text('Archive'),
              onTap: () => Navigator.pop(context, 'archived'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: const Text('Move to trash'),
              onTap: () => Navigator.pop(context, 'trashed'),
            ),
          ],
        ),
      ),
    );
    if (action != null) {
      await ref.read(feedControllerProvider.notifier).moveTo(m, action);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(feedControllerProvider);
    final ctrl = ref.read(feedControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: const BrandWordmark(fontSize: 20),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    textInputAction: TextInputAction.search,
                    decoration: const InputDecoration(
                      hintText: 'Filter memories…',
                      prefixIcon: Icon(Icons.search, size: 20),
                      isDense: true,
                    ),
                    onSubmitted: ctrl.setQuery,
                  ),
                ),
                const SizedBox(width: 8),
                FilterChip(
                  selected: state.favoritesOnly,
                  showCheckmark: false,
                  avatar: Icon(Icons.star,
                      size: 16,
                      color: state.favoritesOnly
                          ? Theme.of(context).colorScheme.onSecondary
                          : Theme.of(context).colorScheme.onSurfaceVariant),
                  label: const Text('Starred'),
                  onSelected: ctrl.setFavoritesOnly,
                ),
              ],
            ),
          ),
          Expanded(child: _body(state, ctrl)),
        ],
      ),
    );
  }

  Widget _body(FeedState state, FeedController ctrl) {
    if (state.loading && state.items.isEmpty) return const LoadingList();
    if (state.error != null && state.items.isEmpty) {
      return ErrorRetry(message: state.error!, onRetry: ctrl.refresh);
    }
    if (state.items.isEmpty) {
      return EmptyState(
        icon: Icons.bookmark_border,
        title: state.query.isNotEmpty ? 'No matches' : 'Your second brain is empty',
        message: state.query.isNotEmpty
            ? 'Try a different filter.'
            : 'Capture a link, note, or file to get started.',
        action: state.query.isEmpty
            ? FilledButton.icon(
                onPressed: () => context.push('/capture'),
                icon: const Icon(Icons.add),
                label: const Text('Capture something'),
              )
            : null,
      );
    }

    return RefreshIndicator(
      onRefresh: ctrl.refresh,
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
        itemCount: state.items.length + (state.hasMore ? 1 : 0),
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, i) {
          if (i >= state.items.length) {
            return const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          final m = state.items[i];
          return MemoryCard(
            memory: m,
            onTap: () => context.push('/memory/${m.id}'),
            onToggleFavorite: () => ctrl.toggleFavorite(m),
            onMore: () => _showMore(m),
          );
        },
      ),
    );
  }
}
