import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../data/ingest_repository.dart';
import '../../models/category.dart';
import '../../providers.dart';

class CaptureScreen extends ConsumerStatefulWidget {
  const CaptureScreen({super.key, this.sharedText});
  final String? sharedText;

  @override
  ConsumerState<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends ConsumerState<CaptureScreen> {
  late final TextEditingController _input;
  final _titleCtrl = TextEditingController();
  int _mode = 0; // 0 = URL, 1 = Text
  String? _collectionId;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final shared = widget.sharedText?.trim() ?? '';
    _input = TextEditingController(text: shared);
    // A shared payload that looks like a URL defaults to URL mode, else Text.
    if (shared.isNotEmpty && !_looksLikeUrl(shared)) _mode = 1;
  }

  @override
  void dispose() {
    _input.dispose();
    _titleCtrl.dispose();
    super.dispose();
  }

  bool _looksLikeUrl(String s) =>
      s.startsWith('http://') || s.startsWith('https://');

  Future<void> _save() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    setState(() => _saving = true);
    final repo = ref.read(ingestRepositoryProvider);
    final locale = ref.read(authControllerProvider).user?.locale;
    try {
      final IngestResult res = _mode == 0
          ? await repo.ingestUrl(text, categoryId: _collectionId, locale: locale)
          : await repo.ingestText(text,
              title: _titleCtrl.text.trim().isEmpty ? null : _titleCtrl.text.trim(),
              categoryId: _collectionId,
              locale: locale);
      if (!mounted) return;
      ref.read(feedControllerProvider.notifier).refresh();
      _toast(res.duplicate
          ? 'Already saved — opened the existing memory.'
          : 'Saved! Processing in the background…');
      context.pop();
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toast(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  @override
  Widget build(BuildContext context) {
    final collections = ref.watch(collectionsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Capture')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 0, icon: Icon(Icons.link), label: Text('Link')),
                ButtonSegment(value: 1, icon: Icon(Icons.notes), label: Text('Note')),
              ],
              selected: {_mode},
              onSelectionChanged: (s) => setState(() => _mode = s.first),
            ),
            const SizedBox(height: 20),
            if (_mode == 0)
              TextField(
                controller: _input,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'URL',
                  hintText: 'https://…',
                  prefixIcon: Icon(Icons.link),
                ),
              )
            else ...[
              TextField(
                controller: _titleCtrl,
                decoration: const InputDecoration(labelText: 'Title (optional)'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _input,
                minLines: 5,
                maxLines: 12,
                decoration: const InputDecoration(
                  labelText: 'Note',
                  hintText: 'Type or paste anything to remember…',
                  alignLabelWithHint: true,
                ),
              ),
            ],
            const SizedBox(height: 20),
            collections.when(
              data: (cols) => _collectionPicker(cols),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            const SizedBox(height: 28),
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.bookmark_add_outlined),
              label: Text(_saving ? 'Saving…' : 'Save to my brain'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _collectionPicker(List<Collection> cols) {
    if (cols.isEmpty) return const SizedBox.shrink();
    return DropdownButtonFormField<String?>(
      initialValue: _collectionId,
      isExpanded: true,
      decoration: const InputDecoration(
        labelText: 'Collection (optional)',
        prefixIcon: Icon(Icons.folder_outlined),
      ),
      items: [
        const DropdownMenuItem<String?>(value: null, child: Text('None')),
        for (final c in cols)
          DropdownMenuItem<String?>(value: c.id, child: Text(c.name)),
      ],
      onChanged: (v) => setState(() => _collectionId = v),
    );
  }
}
