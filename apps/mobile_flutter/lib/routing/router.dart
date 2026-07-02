import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/signup_screen.dart';
import '../features/capture/capture_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/detail/memory_detail_screen.dart';
import '../features/shell/home_shell.dart';
import '../features/splash/splash_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider.select((s) => s.status),
      (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = ref.read(authControllerProvider).status;
      final loc = state.matchedLocation;
      final atAuth = loc == '/login' || loc == '/signup';
      final atSplash = loc == '/splash';

      if (status == AuthStatus.unknown) return atSplash ? null : '/splash';
      if (status == AuthStatus.unauthenticated) return atAuth ? null : '/login';
      // authenticated:
      if (atAuth || atSplash) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/signup', builder: (_, __) => const SignupScreen()),
      GoRoute(path: '/', builder: (_, __) => const HomeShell()),
      GoRoute(
        path: '/capture',
        builder: (_, state) =>
            CaptureScreen(sharedText: state.uri.queryParameters['text']),
      ),
      GoRoute(
        path: '/memory/:id',
        builder: (_, state) => MemoryDetailScreen(id: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/chat/new',
        builder: (_, __) => const ChatScreen(conversationId: null),
      ),
      GoRoute(
        path: '/chat/:id',
        builder: (_, state) =>
            ChatScreen(conversationId: state.pathParameters['id']),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
