import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/backend_url_dialog.dart';

class SettingsTab extends ConsumerWidget {
  const SettingsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final user = auth.user;
    final themeMode = ref.watch(themeControllerProvider);
    final baseUrl = ref.watch(apiClientProvider).baseUrl;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const SizedBox(height: 8),
          // Profile
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: AppColors.brandCyan.withValues(alpha: 0.18),
                  backgroundImage:
                      (user?.image != null && user!.image!.isNotEmpty)
                          ? NetworkImage(user.image!)
                          : null,
                  child: (user?.image == null || user!.image!.isEmpty)
                      ? Text(user?.initials ?? '?',
                          style: const TextStyle(
                              color: AppColors.brandCyan, fontWeight: FontWeight.w700))
                      : null,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(user?.name.isNotEmpty == true ? user!.name : 'Signed in',
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w600)),
                      if (user?.email != null)
                        Text(user!.email,
                            style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(),

          // Appearance
          _sectionLabel(context, 'Appearance'),
          RadioGroup<ThemeMode>(
            groupValue: themeMode,
            onChanged: (m) {
              if (m != null) ref.read(themeControllerProvider.notifier).set(m);
            },
            child: Column(
              children: const [
                RadioListTile<ThemeMode>(
                    value: ThemeMode.system, title: Text('System default')),
                RadioListTile<ThemeMode>(value: ThemeMode.light, title: Text('Light')),
                RadioListTile<ThemeMode>(value: ThemeMode.dark, title: Text('Dark')),
              ],
            ),
          ),
          const Divider(),

          // Backend
          _sectionLabel(context, 'Connection'),
          ListTile(
            leading: const Icon(Icons.dns_outlined),
            title: const Text('Backend server'),
            subtitle: Text(baseUrl),
            trailing: const Icon(Icons.edit_outlined, size: 18),
            onTap: () => showBackendUrlDialog(context, ref),
          ),
          const Divider(),

          // Account
          _sectionLabel(context, 'Account'),
          ListTile(
            leading: Icon(Icons.logout, color: theme.colorScheme.error),
            title: Text('Sign out', style: TextStyle(color: theme.colorScheme.error)),
            onTap: () => _confirmSignOut(context, ref),
          ),

          const SizedBox(height: 24),
          Center(
            child: Text('${AppConfig.appName} · v1.0.0',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _sectionLabel(BuildContext context, String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(text.toUpperCase(),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                letterSpacing: 1)),
      );

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(authControllerProvider.notifier).signOut();
    }
  }
}
