import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/memory.dart';
import 'app_image.dart';

class MemoryCard extends StatelessWidget {
  const MemoryCard({
    super.key,
    required this.memory,
    this.onTap,
    this.onToggleFavorite,
    this.onMore,
  });

  final Memory memory;
  final VoidCallback? onTap;
  final VoidCallback? onToggleFavorite;
  final VoidCallback? onMore;

  IconData get _typeIcon => switch (memory.docType) {
        'file' => Icons.description_outlined,
        'text' => Icons.notes_outlined,
        'doc' => Icons.article_outlined,
        'mindmap' => Icons.account_tree_outlined,
        'sheet' => Icons.grid_on_outlined,
        _ => Icons.link,
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final domain =
        memory.url.isNotEmpty ? (Uri.tryParse(memory.url)?.host ?? '') : '';
    final preview = memory.summary.isNotEmpty ? memory.summary : memory.content;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (memory.hasImage)
              AspectRatio(
                aspectRatio: 16 / 9,
                child: AppImage(path: memory.ogImagePath!),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          memory.title.isNotEmpty ? memory.title : 'Untitled',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w600, height: 1.25),
                        ),
                      ),
                      _FavoriteButton(
                        isFavorite: memory.isFavorite,
                        onPressed: onToggleFavorite,
                      ),
                    ],
                  ),
                  if (preview.trim().isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Text(
                        preview.trim(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant, height: 1.35),
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      if (domain.isNotEmpty) ...[
                        Favicon(url: memory.faviconUrl, size: 14),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(domain,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.labelSmall
                                  ?.copyWith(color: scheme.onSurfaceVariant)),
                        ),
                      ] else
                        Icon(_typeIcon, size: 14, color: scheme.onSurfaceVariant),
                      const Spacer(),
                      if (memory.isProcessing) ...[
                        const _ProcessingBadge(),
                        const SizedBox(width: 8),
                      ],
                      if (onMore != null)
                        InkResponse(
                          onTap: onMore,
                          radius: 18,
                          child: Icon(Icons.more_horiz,
                              size: 18, color: scheme.onSurfaceVariant),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FavoriteButton extends StatelessWidget {
  const _FavoriteButton({required this.isFavorite, this.onPressed});
  final bool isFavorite;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      visualDensity: VisualDensity.compact,
      iconSize: 20,
      onPressed: onPressed,
      icon: Icon(
        isFavorite ? Icons.star : Icons.star_border,
        color: isFavorite
            ? AppColors.brandCyan
            : Theme.of(context).colorScheme.onSurfaceVariant,
      ),
    );
  }
}

class _ProcessingBadge extends StatelessWidget {
  const _ProcessingBadge();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(
          width: 11,
          height: 11,
          child: CircularProgressIndicator(strokeWidth: 1.6, color: AppColors.brandCyan),
        ),
        const SizedBox(width: 5),
        Text('Processing',
            style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant)),
      ],
    );
  }
}
