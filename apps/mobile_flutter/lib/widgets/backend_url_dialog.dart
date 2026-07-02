import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config.dart';
import '../providers.dart';

/// Lets the user point the app at a different backend. Changing it invalidates
/// the API client + repositories so the next request uses the new host.
Future<void> showBackendUrlDialog(BuildContext context, WidgetRef ref) async {
  final storage = ref.read(storageProvider);
  final controller = TextEditingController(text: storage.baseUrl);

  await showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Backend server'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: controller,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(hintText: 'https://mind.sayknow.ai'),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              ActionChip(
                label: const Text('Production'),
                onPressed: () => controller.text = AppConfig.defaultBaseUrl,
              ),
              ActionChip(
                label: const Text('Localhost'),
                onPressed: () => controller.text = AppConfig.localBaseUrl,
              ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () async {
            await storage.setBaseUrl(controller.text);
            // Drop cached clients/repos so they rebuild against the new URL.
            ref.invalidate(apiClientProvider);
            if (context.mounted) Navigator.pop(context);
          },
          child: const Text('Save'),
        ),
      ],
    ),
  );
}
