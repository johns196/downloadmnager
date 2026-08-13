import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../state/download_store.dart";

class AddLinkDialog extends StatefulWidget {
  const AddLinkDialog({super.key});

  @override
  State<AddLinkDialog> createState() => _AddLinkDialogState();
}

class _AddLinkDialogState extends State<AddLinkDialog> {
  final _urlController = TextEditingController();
  final _filenameController = TextEditingController();
  int _chunks = 4;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _urlController.dispose();
    _filenameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) {
      setState(() => _error = "Enter a URL");
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await context.read<DownloadStore>().addLink(
            url,
            filename: _filenameController.text.trim().isEmpty ? null : _filenameController.text.trim(),
            chunks: _chunks,
          );
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text("Add download"),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _urlController,
              autofocus: true,
              decoration: const InputDecoration(labelText: "URL", hintText: "https://example.com/file.zip"),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _filenameController,
              decoration: const InputDecoration(labelText: "Filename (optional)"),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Text("Parallel chunks:"),
                Expanded(
                  child: Slider(
                    value: _chunks.toDouble(),
                    min: 1,
                    max: 16,
                    divisions: 15,
                    label: "$_chunks",
                    onChanged: (v) => setState(() => _chunks = v.round()),
                  ),
                ),
                Text("$_chunks"),
              ],
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text("Cancel")),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text("Add"),
        ),
      ],
    );
  }
}
