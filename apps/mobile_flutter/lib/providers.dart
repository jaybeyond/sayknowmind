import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api_client.dart';
import 'core/storage.dart';
import 'data/auth_repository.dart';
import 'data/category_repository.dart';
import 'data/chat_repository.dart';
import 'data/document_repository.dart';
import 'data/ingest_repository.dart';
import 'data/search_repository.dart';
import 'models/app_user.dart';
import 'models/category.dart';
import 'models/memory.dart';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

/// Overridden in main() with the loaded instance.
final storageProvider = Provider<AppStorage>((_) => throw UnimplementedError());

final apiClientProvider = Provider<ApiClient>((ref) {
  final api = ApiClient(ref.watch(storageProvider));
  api.onUnauthorized =
      () => ref.read(authControllerProvider.notifier).onSessionExpired();
  return api;
});

final authRepositoryProvider = Provider(
    (ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(storageProvider)));
final documentRepositoryProvider =
    Provider((ref) => DocumentRepository(ref.watch(apiClientProvider)));
final ingestRepositoryProvider =
    Provider((ref) => IngestRepository(ref.watch(apiClientProvider)));
final searchRepositoryProvider =
    Provider((ref) => SearchRepository(ref.watch(apiClientProvider)));
final categoryRepositoryProvider =
    Provider((ref) => CategoryRepository(ref.watch(apiClientProvider)));
final chatRepositoryProvider =
    Provider((ref) => ChatRepository(ref.watch(apiClientProvider)));

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

class ThemeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => _parse(ref.read(storageProvider).themeMode);

  static ThemeMode _parse(String s) => switch (s) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };

  Future<void> set(ThemeMode mode) async {
    state = mode;
    await ref.read(storageProvider).setThemeMode(mode.name);
  }
}

final themeControllerProvider =
    NotifierProvider<ThemeController, ThemeMode>(ThemeController.new);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({this.status = AuthStatus.unknown, this.user, this.busy = false, this.error});
  final AuthStatus status;
  final AppUser? user;
  final bool busy;
  final String? error;

  AuthState copyWith({AuthStatus? status, AppUser? user, bool? busy, String? error}) =>
      AuthState(
        status: status ?? this.status,
        user: user ?? this.user,
        busy: busy ?? this.busy,
        error: error,
      );
}

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() => const AuthState();

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  Future<void> bootstrap() async {
    try {
      final user = await _repo.currentUser();
      state = AuthState(
        status: user == null ? AuthStatus.unauthenticated : AuthStatus.authenticated,
        user: user,
      );
    } catch (_) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  Future<bool> signIn(String email, String password) =>
      _run(() => _repo.signIn(email, password));

  Future<bool> signUp(String name, String email, String password) =>
      _run(() => _repo.signUp(name, email, password));

  Future<bool> _run(Future<AppUser> Function() action) async {
    state = state.copyWith(busy: true, error: null);
    try {
      final user = await action();
      state = AuthState(status: AuthStatus.authenticated, user: user);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, error: e.message);
      return false;
    } catch (e) {
      state = state.copyWith(busy: false, error: 'Something went wrong. Try again.');
      return false;
    }
  }

  Future<void> signOut() async {
    await _repo.signOut();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  void onSessionExpired() {
    if (state.status == AuthStatus.authenticated) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }
}

final authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);

// ---------------------------------------------------------------------------
// Feed (paginated, filtered)
// ---------------------------------------------------------------------------

class FeedState {
  const FeedState({
    this.items = const [],
    this.loading = false,
    this.loadingMore = false,
    this.hasMore = true,
    this.page = 1,
    this.error,
    this.query = '',
    this.categoryId,
    this.sourceType,
    this.favoritesOnly = false,
    this.status = 'active',
  });

  final List<Memory> items;
  final bool loading;
  final bool loadingMore;
  final bool hasMore;
  final int page;
  final String? error;
  final String query;
  final String? categoryId;
  final String? sourceType;
  final bool favoritesOnly;
  final String status;

  FeedState copyWith({
    List<Memory>? items,
    bool? loading,
    bool? loadingMore,
    bool? hasMore,
    int? page,
    String? error,
    String? query,
    Object? categoryId = _sentinel,
    Object? sourceType = _sentinel,
    bool? favoritesOnly,
    String? status,
  }) =>
      FeedState(
        items: items ?? this.items,
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        hasMore: hasMore ?? this.hasMore,
        page: page ?? this.page,
        error: error,
        query: query ?? this.query,
        categoryId: categoryId == _sentinel ? this.categoryId : categoryId as String?,
        sourceType: sourceType == _sentinel ? this.sourceType : sourceType as String?,
        favoritesOnly: favoritesOnly ?? this.favoritesOnly,
        status: status ?? this.status,
      );

  static const _sentinel = Object();
}

class FeedController extends Notifier<FeedState> {
  @override
  FeedState build() => const FeedState();

  DocumentRepository get _repo => ref.read(documentRepositoryProvider);

  Future<void> refresh() async {
    state = state.copyWith(loading: true, error: null);
    try {
      final page = await _repo.list(
        page: 1,
        q: state.query.isEmpty ? null : state.query,
        categoryId: state.categoryId,
        sourceType: state.sourceType,
        isFavorite: state.favoritesOnly ? true : null,
        status: state.status,
      );
      state = state.copyWith(
        items: page.items,
        loading: false,
        hasMore: page.hasMore,
        page: 1,
      );
    } on ApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    }
  }

  Future<void> loadMore() async {
    if (state.loadingMore || !state.hasMore || state.loading) return;
    state = state.copyWith(loadingMore: true);
    try {
      final next = state.page + 1;
      final page = await _repo.list(
        page: next,
        q: state.query.isEmpty ? null : state.query,
        categoryId: state.categoryId,
        sourceType: state.sourceType,
        isFavorite: state.favoritesOnly ? true : null,
        status: state.status,
      );
      state = state.copyWith(
        items: [...state.items, ...page.items],
        loadingMore: false,
        hasMore: page.hasMore,
        page: next,
      );
    } on ApiException catch (e) {
      state = state.copyWith(loadingMore: false, error: e.message);
    }
  }

  void setQuery(String q) {
    state = state.copyWith(query: q);
    refresh();
  }

  void setCategory(String? categoryId) {
    state = state.copyWith(categoryId: categoryId);
    refresh();
  }

  void setFavoritesOnly(bool v) {
    state = state.copyWith(favoritesOnly: v);
    refresh();
  }

  /// Optimistic favorite toggle + persist.
  Future<void> toggleFavorite(Memory m) async {
    final next = !m.isFavorite;
    _replace(m.id, (cur) => _withFavorite(cur, next));
    try {
      await _repo.setFavorite(m.id, next);
    } catch (_) {
      _replace(m.id, (cur) => _withFavorite(cur, !next)); // revert
    }
  }

  /// Move to trash/archive and drop from the current list.
  Future<void> moveTo(Memory m, String status) async {
    state = state.copyWith(items: state.items.where((x) => x.id != m.id).toList());
    try {
      await _repo.setStatus(m.id, status);
    } catch (_) {
      refresh();
    }
  }

  void _replace(String id, Memory Function(Memory) f) {
    state = state.copyWith(
      items: [for (final x in state.items) if (x.id == id) f(x) else x],
    );
  }

  static Memory _withFavorite(Memory m, bool fav) => Memory(
        id: m.id,
        title: m.title,
        content: m.content,
        url: m.url,
        summary: m.summary,
        faviconUrl: m.faviconUrl,
        categoryIds: m.categoryIds,
        categories: m.categories,
        tags: m.tags,
        aiTags: m.aiTags,
        userTags: m.userTags,
        createdAt: m.createdAt,
        isFavorite: fav,
        privacyLevel: m.privacyLevel,
        docType: m.docType,
        fileType: m.fileType,
        aiSummary: m.aiSummary,
        whatItSolves: m.whatItSolves,
        keyPoints: m.keyPoints,
        readingTimeMinutes: m.readingTimeMinutes,
        ogImagePath: m.ogImagePath,
        status: m.status,
        jobStatus: m.jobStatus,
      );
}

final feedControllerProvider =
    NotifierProvider<FeedController, FeedState>(FeedController.new);

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

final collectionsProvider = FutureProvider<List<Collection>>(
    (ref) => ref.watch(categoryRepositoryProvider).collections());
