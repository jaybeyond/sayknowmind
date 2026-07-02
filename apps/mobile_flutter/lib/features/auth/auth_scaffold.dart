import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';
import '../../widgets/backend_url_dialog.dart';

/// Shared chrome for login/signup: centered, scrollable, with a quick action to
/// point the app at a different backend before signing in.
class AuthScaffold extends ConsumerWidget {
  const AuthScaffold({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final baseUrl = ref.watch(apiClientProvider).baseUrl;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        actions: [
          TextButton.icon(
            onPressed: () => showBackendUrlDialog(context, ref),
            icon: const Icon(Icons.dns_outlined, size: 18),
            label: Text(
              Uri.tryParse(baseUrl)?.host ?? baseUrl,
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}
