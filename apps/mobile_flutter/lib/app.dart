import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config.dart';
import 'core/theme.dart';
import 'providers.dart';
import 'routing/router.dart';

class SayKnowMindApp extends ConsumerStatefulWidget {
  const SayKnowMindApp({super.key});

  @override
  ConsumerState<SayKnowMindApp> createState() => _SayKnowMindAppState();
}

class _SayKnowMindAppState extends ConsumerState<SayKnowMindApp> {
  @override
  void initState() {
    super.initState();
    // Validate any stored session before the first frame settles.
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => ref.read(authControllerProvider.notifier).bootstrap(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeControllerProvider);
    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: themeMode,
      routerConfig: router,
    );
  }
}
