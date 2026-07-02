import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';
import '../../models/memory.dart';
import '../../providers.dart';
import '../../widgets/app_image.dart';
import '../../widgets/states.dart';

class MemoryDetailScreen extends ConsumerStatefulWidget {
  const MemoryDetailScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<MemoryDetailScreen> createState() => _MemoryDetailScreenState();
}

class _MemoryDetailScreenState extends ConsumerState<MemoryDetailScreen> {
  late Future<Memory> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(documentRepositoryProvider).get(widget.id);
  }

  void _reload() =>
      setState(() => _future = ref.read(documentRepositoryProvider).get(widget.id));

  Future<void> _openSource(String url) async {
    final uri = Uri.tryParse(url);
    if (uri != null) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete permanently?'),
        content: const Text('This memory will be removed for good.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(documentRepositoryProvider).hardDelete(widget.id);
      if (mounted) {
        ref.read(feedControllerProvider.notifier).refresh();
        context.pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: FutureBuilder<Memory>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const SafeArea(child: LoadingList());
          }
          if (snap.hasError || !snap.hasData) {
            return SafeArea(
              child: ErrorRetry(
                message: 'Could not load this memory.',
                onRetry: _reload,
              ),
            );
          }
          return _content(snap.data!);
        },
      ),
    );
  }

  Widget _content(Memory m) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final body = m.content.trim();

    return CustomScrollView(
      slivers: [
        SliverAppBar(
          pinned: true,
          expandedHeight: m.hasImage ? 240 : null,
          actions: [
            IconButton(
              icon: const Icon(Icons.more_vert),
              onPressed: () => _showActions(m),
            ),
          ],
          flexibleSpace: m.hasImage
              ? FlexibleSpaceBar(
                  background: AppImage(path: m.ogImagePath!),
                )
              : null,
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 48),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(m.title.isNotEmpty ? m.title : 'Untitled',
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                if (m.url.isNotEmpty)
                  InkWell(
                    onTap: () => _openSource(m.url),
                    child: Row(
                      children: [
                        Favicon(url: m.faviconUrl, size: 16),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            Uri.tryParse(m.url)?.host ?? m.url,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: AppColors.brandCyan, fontSize: 13),
                          ),
                        ),
                        const Icon(Icons.open_in_new, size: 14, color: AppColors.brandCyan),
                      ],
                    ),
                  ),
                if (m.tags.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [for (final t in m.tags) Chip(label: Text(t))],
                  ),
                ],
                if (m.aiSummary != null && m.aiSummary!.trim().isNotEmpty) ...[
                  const SizedBox(height: 20),
                  _SectionCard(
                    icon: Icons.auto_awesome,
                    title: 'AI Summary',
                    child: MarkdownBody(data: m.aiSummary!),
                  ),
                ],
                if (m.whatItSolves != null && m.whatItSolves!.trim().isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _SectionCard(
                    icon: Icons.lightbulb_outline,
                    title: 'What it solves',
                    child: Text(m.whatItSolves!,
                        style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
                  ),
                ],
                if (m.keyPoints.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _SectionCard(
                    icon: Icons.format_list_bulleted,
                    title: 'Key points',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final p in m.keyPoints)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('•  '),
                                Expanded(child: Text(p, style: const TextStyle(height: 1.4))),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
                if (body.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Divider(color: scheme.outline),
                  const SizedBox(height: 8),
                  MarkdownBody(data: body, selectable: true),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _showActions(Memory m) async {
    final repo = ref.read(documentRepositoryProvider);
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(m.isFavorite ? Icons.star : Icons.star_border),
              title: Text(m.isFavorite ? 'Remove star' : 'Add star'),
              onTap: () => Navigator.pop(context, 'fav'),
            ),
            ListTile(
              leading: const Icon(Icons.archive_outlined),
              title: const Text('Archive'),
              onTap: () => Navigator.pop(context, 'archive'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: const Text('Delete permanently'),
              onTap: () => Navigator.pop(context, 'delete'),
            ),
          ],
        ),
      ),
    );
    switch (action) {
      case 'fav':
        await repo.setFavorite(m.id, !m.isFavorite);
        ref.read(feedControllerProvider.notifier).refresh();
        _reload();
      case 'archive':
        await repo.setStatus(m.id, 'archived');
        if (mounted) {
          ref.read(feedControllerProvider.notifier).refresh();
          context.pop();
        }
      case 'delete':
        await _confirmDelete();
    }
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.icon, required this.title, required this.child});
  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(kRadiusLg),
        border: Border.all(color: theme.colorScheme.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: AppColors.brandCyan),
              const SizedBox(width: 8),
              Text(title,
                  style: theme.textTheme.labelLarge
                      ?.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}
