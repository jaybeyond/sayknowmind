import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../models/search_result.dart';
import '../../providers.dart';
import '../../widgets/states.dart';

class SearchTab extends ConsumerStatefulWidget {
  const SearchTab({super.key});

  @override
  ConsumerState<SearchTab> createState() => _SearchTabState();
}

class _SearchTabState extends ConsumerState<SearchTab> {
  final _controller = TextEditingController();
  List<SearchHit>? _results;
  bool _loading = false;
  String? _error;
  String _lastQuery = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _run(String query) async {
    final q = query.trim();
    if (q.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
      _lastQuery = q;
    });
    try {
      final hits = await ref.read(searchRepositoryProvider).search(q);
      if (mounted) setState(() {
        _results = hits;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Search'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: TextField(
              controller: _controller,
              autofocus: false,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Ask your knowledge anything…',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _controller.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _controller.clear();
                          setState(() => _results = null);
                        },
                      ),
              ),
              onChanged: (_) => setState(() {}),
              onSubmitted: _run,
            ),
          ),
        ),
      ),
      body: _body(theme),
    );
  }

  Widget _body(ThemeData theme) {
    if (_loading) return const LoadingList();
    if (_error != null) {
      return ErrorRetry(message: _error!, onRetry: () => _run(_lastQuery));
    }
    if (_results == null) {
      return const EmptyState(
        icon: Icons.travel_explore,
        title: 'Semantic search',
        message: 'Search across everything you\'ve saved — by meaning, not just keywords.',
      );
    }
    if (_results!.isEmpty) {
      return EmptyState(
        icon: Icons.search_off,
        title: 'No results for "$_lastQuery"',
        message: 'Try rephrasing your query.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
      itemCount: _results!.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final hit = _results![i];
        return ListTile(
          contentPadding: const EdgeInsets.symmetric(vertical: 8),
          title: Text(hit.title.isNotEmpty ? hit.title : 'Untitled',
              maxLines: 2, overflow: TextOverflow.ellipsis),
          subtitle: hit.snippet.isEmpty
              ? null
              : Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(hit.snippet,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                ),
          trailing: const Icon(Icons.chevron_right),
          onTap: hit.documentId.isEmpty
              ? null
              : () => context.push('/memory/${hit.documentId}'),
        );
      },
    );
  }
}
