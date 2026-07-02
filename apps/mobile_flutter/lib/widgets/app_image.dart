import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';

/// Renders an image from an API-relative path (e.g. `/api/og/{id}`) using the
/// bearer token so private-document thumbnails resolve. Falls back gracefully.
class AppImage extends ConsumerWidget {
  const AppImage({
    super.key,
    required this.path,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
  });

  final String path;
  final BoxFit fit;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(apiClientProvider);
    final scheme = Theme.of(context).colorScheme;
    return FutureBuilder<Map<String, String>>(
      future: api.authHeaders(),
      builder: (context, snap) {
        if (!snap.hasData) {
          return Container(width: width, height: height, color: scheme.surfaceContainerHighest);
        }
        return CachedNetworkImage(
          imageUrl: api.absolute(path),
          httpHeaders: snap.data,
          fit: fit,
          width: width,
          height: height,
          placeholder: (_, __) =>
              Container(color: scheme.surfaceContainerHighest),
          errorWidget: (_, __, ___) => Container(
            color: scheme.surfaceContainerHighest,
            child: Icon(Icons.image_not_supported_outlined,
                color: scheme.onSurfaceVariant, size: 28),
          ),
        );
      },
    );
  }
}

/// Small favicon (loaded directly from Google's S2 service, no auth needed).
class Favicon extends StatelessWidget {
  const Favicon({super.key, required this.url, this.size = 16});
  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fallback = Icon(Icons.public, size: size, color: scheme.onSurfaceVariant);
    if (url == null || url!.isEmpty) return fallback;
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: CachedNetworkImage(
        imageUrl: url!,
        width: size,
        height: size,
        errorWidget: (_, __, ___) => fallback,
        placeholder: (_, __) => SizedBox(width: size, height: size),
      ),
    );
  }
}
