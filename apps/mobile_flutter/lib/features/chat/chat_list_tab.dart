import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../models/chat.dart';
import '../../providers.dart';
import '../../widgets/states.dart';

final conversationsProvider = FutureProvider<List<Conversation>>(
    (ref) => ref.watch(chatRepositoryProvider).conversations());

class ChatListTab extends ConsumerWidget {
  const ChatListTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conversations = ref.watch(conversationsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Chat')),
      body: conversations.when(
        loading: () => const LoadingList(),
        error: (e, _) => ErrorRetry(
          message: '$e',
          onRetry: () => ref.invalidate(conversationsProvider),
        ),
        data: (items) {
          if (items.isEmpty) {
            return EmptyState(
              icon: Icons.forum_outlined,
              title: 'Chat with your brain',
              message: 'Ask questions and get answers grounded in everything you\'ve saved.',
              action: FilledButton.icon(
                onPressed: () => context.push('/chat/new'),
                icon: const Icon(Icons.add_comment_outlined),
                label: const Text('New chat'),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(conversationsProvider),
            child: ListView.separated(
              padding: const EdgeInsets.only(bottom: 96),
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final c = items[i];
                return Dismissible(
                  key: ValueKey(c.id),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    color: Theme.of(context).colorScheme.error,
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 20),
                    child: const Icon(Icons.delete, color: Colors.white),
                  ),
                  onDismissed: (_) async {
                    await ref.read(chatRepositoryProvider).deleteConversation(c.id);
                    ref.invalidate(conversationsProvider);
                  },
                  child: ListTile(
                    leading: const Icon(Icons.chat_bubble_outline),
                    title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(DateFormat.yMMMd().add_jm().format(c.updatedAt)),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/chat/${c.id}'),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
