import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../models/chat.dart';
import '../../providers.dart';
import 'chat_list_tab.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.conversationId});
  final String? conversationId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<ChatMessage> _messages = [];
  String? _conversationId;
  bool _streaming = false;
  bool _loadingHistory = false;
  String _status = '';

  @override
  void initState() {
    super.initState();
    _conversationId = widget.conversationId;
    if (_conversationId != null) _loadHistory();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    setState(() => _loadingHistory = true);
    try {
      final msgs = await ref.read(chatRepositoryProvider).messages(_conversationId!);
      setState(() {
        _messages
          ..clear()
          ..addAll(msgs);
        _loadingHistory = false;
      });
      _scrollToBottom();
    } catch (_) {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _streaming) return;
    _input.clear();

    final assistant = ChatMessage(role: 'assistant', content: '', streaming: true);
    setState(() {
      _messages.add(ChatMessage(role: 'user', content: text));
      _messages.add(assistant);
      _streaming = true;
      _status = 'Thinking…';
    });
    _scrollToBottom();

    try {
      final stream = ref
          .read(chatRepositoryProvider)
          .streamChat(text, conversationId: _conversationId);
      await for (final ev in stream) {
        switch (ev.type) {
          case 'status':
          case 'log':
            if (mounted) setState(() => _status = ev.text ?? _status);
          case 'answer':
            final t = ev.text;
            if (t != null && t.isNotEmpty) {
              setState(() => assistant.content += t);
              _scrollToBottom();
            }
          case 'sources':
            setState(() => assistant.citations = ev.sources);
          case 'done':
            _conversationId ??= ev.conversationId;
          case 'error':
            setState(() => assistant.content +=
                '\n\n_⚠️ ${ev.text ?? 'Something went wrong.'}_');
        }
      }
    } on ApiException catch (e) {
      setState(() {
        if (assistant.content.isEmpty) {
          assistant.content = '⚠️ ${e.message}';
        } else {
          assistant.content += '\n\n_⚠️ ${e.message}_';
        }
      });
    } finally {
      if (mounted) {
        setState(() {
          assistant.streaming = false;
          _streaming = false;
          _status = '';
        });
        // Refresh the conversation list so a newly created thread shows up.
        ref.invalidate(conversationsProvider);
        _scrollToBottom();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat'),
        bottom: _streaming && _status.isNotEmpty
            ? PreferredSize(
                preferredSize: const Size.fromHeight(2),
                child: LinearProgressIndicator(
                  minHeight: 2,
                  color: AppColors.brandCyan,
                  backgroundColor: Colors.transparent,
                ),
              )
            : null,
      ),
      body: Column(
        children: [
          Expanded(child: _list()),
          _composer(),
        ],
      ),
    );
  }

  Widget _list() {
    if (_loadingHistory) return const Center(child: CircularProgressIndicator());
    if (_messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.auto_awesome, size: 48, color: AppColors.brandCyan),
              const SizedBox(height: 16),
              Text('Ask anything',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(
                'Answers are grounded in your saved memories.',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      );
    }
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.all(16),
      itemCount: _messages.length,
      itemBuilder: (context, i) => _bubble(_messages[i]),
    );
  }

  Widget _bubble(ChatMessage m) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final isUser = m.isUser;
    final showThinking = m.streaming && m.content.isEmpty;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.82),
        decoration: BoxDecoration(
          color: isUser ? scheme.primary : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(kRadiusLg),
            topRight: const Radius.circular(kRadiusLg),
            bottomLeft: Radius.circular(isUser ? kRadiusLg : 4),
            bottomRight: Radius.circular(isUser ? 4 : kRadiusLg),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (showThinking)
              Text(_status.isEmpty ? 'Thinking…' : _status,
                  style: TextStyle(color: scheme.onSurfaceVariant, fontStyle: FontStyle.italic))
            else if (isUser)
              Text(m.content, style: TextStyle(color: scheme.onPrimary, height: 1.4))
            else
              MarkdownBody(
                data: m.content,
                onTapLink: (text, href, title) {
                  if (href != null) {
                    launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
                  }
                },
              ),
            if (m.citations.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final c in m.citations) _CitationChip(citation: c),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _composer() {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border(top: BorderSide(color: scheme.outline)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _input,
                minLines: 1,
                maxLines: 5,
                textInputAction: TextInputAction.send,
                decoration: const InputDecoration(
                  hintText: 'Message your brain…',
                  isDense: true,
                ),
                onSubmitted: (_) => _send(),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed: _streaming ? null : _send,
              style: IconButton.styleFrom(
                backgroundColor: AppColors.brandCyan,
                foregroundColor: const Color(0xFF002328),
              ),
              icon: const Icon(Icons.arrow_upward),
            ),
          ],
        ),
      ),
    );
  }
}

class _CitationChip extends StatelessWidget {
  const _CitationChip({required this.citation});
  final Citation citation;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ActionChip(
      avatar: const Icon(Icons.link, size: 14),
      label: Text(
        citation.title.isNotEmpty ? citation.title : 'Source',
        style: const TextStyle(fontSize: 11),
      ),
      visualDensity: VisualDensity.compact,
      backgroundColor: scheme.surface,
      onPressed: () {
        final url = citation.url;
        if (url != null && url.isNotEmpty) {
          launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
        }
      },
    );
  }
}
