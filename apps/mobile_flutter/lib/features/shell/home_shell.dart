import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../chat/chat_list_tab.dart';
import '../collections/collections_tab.dart';
import '../feed/feed_tab.dart';
import '../search/search_tab.dart';
import '../settings/settings_tab.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  static const _tabs = [
    FeedTab(),
    SearchTab(),
    ChatListTab(),
    CollectionsTab(),
    SettingsTab(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _tabs),
      floatingActionButton: _fab(context),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        items: const [
          BottomNavigationBarItem(
              icon: Icon(Icons.auto_awesome_mosaic_outlined),
              activeIcon: Icon(Icons.auto_awesome_mosaic),
              label: 'Memories'),
          BottomNavigationBarItem(
              icon: Icon(Icons.search), label: 'Search'),
          BottomNavigationBarItem(
              icon: Icon(Icons.forum_outlined),
              activeIcon: Icon(Icons.forum),
              label: 'Chat'),
          BottomNavigationBarItem(
              icon: Icon(Icons.folder_outlined),
              activeIcon: Icon(Icons.folder),
              label: 'Collections'),
          BottomNavigationBarItem(
              icon: Icon(Icons.settings_outlined),
              activeIcon: Icon(Icons.settings),
              label: 'Settings'),
        ],
      ),
    );
  }

  Widget? _fab(BuildContext context) {
    switch (_index) {
      case 0:
      case 1:
      case 3:
        return FloatingActionButton.extended(
          onPressed: () => context.push('/capture'),
          icon: const Icon(Icons.add),
          label: const Text('Capture'),
        );
      case 2:
        return FloatingActionButton(
          onPressed: () => context.push('/chat/new'),
          child: const Icon(Icons.add_comment_outlined),
        );
      default:
        return null;
    }
  }
}
